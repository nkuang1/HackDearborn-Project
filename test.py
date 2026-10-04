import json
import mimetypes
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


PROJECT_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = PROJECT_DIR / "uploads"
MAX_FILE_SIZE = 10 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/webp": (b"RIFF",),
    "image/gif": (b"GIF87a", b"GIF89a"),
    "image/avif": (b"ftypavif", b"ftypavis"),
}
IMAGE_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
}
HISTORY = {}
HISTORY_LOCK = threading.Lock()


def detect_image_type(image_data):
    if image_data.startswith(b"RIFF") and image_data[8:12] == b"WEBP":
        return "image/webp"

    if image_data[4:12] in ALLOWED_IMAGE_TYPES["image/avif"]:
        return "image/avif"

    for image_type in ("image/jpeg", "image/png", "image/gif"):
        if image_data.startswith(ALLOWED_IMAGE_TYPES[image_type]):
            return image_type

    return None


class ImageUploadHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PROJECT_DIR), **kwargs)

    def send_json(self, status, payload):
        response = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(response)

    def do_GET(self):
        request_path = unquote(urlsplit(self.path).path)
        if request_path == "/health":
            self.send_json(200, {"status": "ok"})
            return

        if request_path == "/api/history":
            with HISTORY_LOCK:
                entries = list(reversed(list(HISTORY.values())))
            self.send_json(200, {"entries": entries})
            return

        cookie_match = re.fullmatch(r"/cookie/([0-9a-f]{32})", request_path)
        if cookie_match is not None:
            cookie_path = UPLOAD_DIR / cookie_match.group(1) / "cookiefied_image.jpg"
            try:
                cookie_image = cookie_path.read_bytes()
            except FileNotFoundError:
                self.send_json(404, {"error": "The generated cookie image was not found."})
                return
            except OSError as error:
                self.log_error("Failed to read generated cookie image: %s", error)
                self.send_json(500, {"error": "The generated cookie image could not be read."})
                return

            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(cookie_image)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(cookie_image)
            return

        public_files = {
            "/": "index.html",
            "/index.html": "index.html",
            "/history": "history.html",
            "/history.html": "history.html",
            "/app.js": "app.js",
            "/history.js": "history.js",
            "/recipe.js": "recipe.js",
            "/styles.css": "styles.css",
        }
        file_name = public_files.get(request_path)
        if file_name is None:
            self.send_error(404, "Not found")
            return

        file_path = PROJECT_DIR / file_name
        try:
            content = file_path.read_bytes()
        except OSError as error:
            self.log_error("Failed to serve %s: %s", file_name, error)
            self.send_json(500, {"error": "The requested app file could not be read."})
            return

        self.send_response(200)
        self.send_header(
            "Content-Type",
            mimetypes.guess_type(file_name)[0] or "application/octet-stream",
        )
        self.send_header("Content-Length", str(len(content)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        if urlsplit(self.path).path != "/upload":
            self.send_json(404, {"error": "Not found."})
            return

        try:
            content_length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self.send_json(400, {"error": "A valid Content-Length header is required."})
            return

        if content_length <= 0:
            self.send_json(400, {"error": "The image is empty."})
            return

        if content_length > MAX_FILE_SIZE:
            self.close_connection = True
            self.send_json(413, {"error": "Images must be 10 MB or smaller."})
            return

        image_data = self.rfile.read(content_length)
        if len(image_data) != content_length:
            self.close_connection = True
            self.send_json(400, {"error": "The image upload was incomplete."})
            return

        image_type = detect_image_type(image_data)
        declared_type = self.headers.get_content_type()
        if image_type is None or image_type not in ALLOWED_IMAGE_TYPES:
            self.send_json(415, {"error": "The uploaded data is not a supported image."})
            return

        if declared_type != image_type:
            self.send_json(415, {"error": "The image data does not match its content type."})
            return

        image_filename = f"uploaded{IMAGE_EXTENSIONS[image_type]}"
        upload_id = uuid.uuid4().hex
        upload_directory = UPLOAD_DIR / upload_id
        image_path = upload_directory / image_filename
        try:
            upload_directory.mkdir(parents=True, exist_ok=False)
            image_path.write_bytes(image_data)
        except OSError as error:
            self.log_error("Failed to store uploaded image %s: %s", upload_id, error)
            self.send_json(500, {"error": "The server could not save this image."})
            return

        print(
            f"SUCCESS: Received {image_filename} ({len(image_data)} bytes); "
            f"saved as uploads/{upload_id}/{image_filename}",
            flush=True,
        )

        try:
            from cookiefy import generate_cookie_recipe

            cookiefied_image_path = upload_directory / "cookiefied_image.jpg"
            recipe = generate_cookie_recipe(image_path, cookiefied_image_path)
            if not cookiefied_image_path.is_file() or cookiefied_image_path.stat().st_size == 0:
                raise ValueError("Cookie image generation did not create an image.")
            if not isinstance(recipe, str) or not recipe.strip():
                raise ValueError("Recipe generation returned no recipe text.")
        except Exception as error:
            self.log_error("Failed to generate a cookie recipe for upload %s: %s", upload_id, error)
            try:
                for generated_file in upload_directory.iterdir():
                    generated_file.unlink()
                upload_directory.rmdir()
            except OSError as cleanup_error:
                self.log_error("Failed to clean up upload %s: %s", upload_id, cleanup_error)
            self.send_json(
                502,
                {"error": "The image was received, but a cookie recipe could not be generated."},
            )
            return

        entry = {
            "upload_id": upload_id,
            "recipe": recipe,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        with HISTORY_LOCK:
            HISTORY[upload_id] = entry

        self.send_json(
            201,
            {
                "message": "Image received.",
                "filename": image_filename,
                "size": len(image_data),
                "upload_id": upload_id,
                "recipe": recipe,
                "created_at": entry["created_at"],
            },
        )

    def do_DELETE(self):
        request_path = urlsplit(self.path).path
        match = re.fullmatch(r"/upload/([0-9a-f]{32})", request_path)
        if match is None:
            self.send_json(404, {"error": "Not found."})
            return

        upload_id = match.group(1)
        upload_directory = UPLOAD_DIR / upload_id
        try:
            stored_files = list(upload_directory.glob("uploaded.*"))
        except OSError as error:
            self.log_error("Failed to find uploaded image %s: %s", upload_id, error)
            self.send_json(500, {"error": "The server could not find this image."})
            return

        if len(stored_files) != 1 or not stored_files[0].is_file():
            self.send_json(404, {"error": "The uploaded image was not found."})
            return

        image_path = stored_files[0]
        try:
            for stored_file in upload_directory.iterdir():
                stored_file.unlink()
            upload_directory.rmdir()
        except OSError as error:
            self.log_error("Failed to delete uploaded image %s: %s", upload_id, error)
            self.send_json(500, {"error": "The server could not delete this image."})
            return

        with HISTORY_LOCK:
            HISTORY.pop(upload_id, None)

        print(f"SUCCESS: Deleted uploads/{upload_id}/{image_path.name}", flush=True)
        self.send_json(
            200,
            {
                "message": "Image deleted.",
                "filename": image_path.name,
                "upload_id": upload_id,
            },
        )


def main():
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), ImageUploadHandler)
    print(f"Open http://{host}:{port} to use the image uploader. Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping image upload server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()