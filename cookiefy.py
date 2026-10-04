from google import genai
from PIL import Image
import base64
import os
import tempfile
from dotenv import load_dotenv

# resize the image to 300 x 400
def resize_image(image_path, output_path):
    img = Image.open(image_path)
    res = img.resize((300, 400))
    res.save(output_path, format="JPEG")

# convert uploaded image to cookie image
def convert_to_cookie(user, resized_image_path, cookiefied_image_path):
    with open(resized_image_path, "rb") as f:
        image_bytes = f.read()

    interaction = user.interactions.create(
        model="gemini-3.1-flash-lite-image",
        input=[
            {
            "type": "text",
            "text": "Change the image so the item is in the shape of a flat cookie"
            },
            {
                "type": "image",
                "data": base64.b64encode(image_bytes).decode('utf-8'),
                "mime_type": "image/jpeg"
            }
        ],
    )

    with open(cookiefied_image_path, "wb") as f:
        f.write(base64.b64decode(interaction.output_image.data))

# generate a recipe for the cookie image
def generate_recipe(user, cookiefied_image_path):
    with open(cookiefied_image_path, 'rb') as f:
        image_bytes = f.read()

    interaction = user.interactions.create(
        model="gemini-3.8-flash",
        input=[
            {"type": "text", "text": "Create a recipe for the cookie in this image. Provide only the title, ingredients, and recipe steps."},
            {
                "type": "image",
                "data": base64.b64encode(image_bytes).decode('utf-8'),
                "mime_type": "image/jpeg"
            }
        ]
    )

    return interaction.output_text
    
def generate_cookie_recipe(image_path, cookiefied_image_path):
    load_dotenv()
    gemini_key = os.getenv('GEMINI_API_KEY')
    client = genai.Client(api_key=gemini_key)
    with tempfile.TemporaryDirectory() as working_directory:
        resized_image_path = os.path.join(working_directory, "resized.jpg")
        resize_image(image_path, resized_image_path)

        # costs 4 cents to run!!!!
        convert_to_cookie(client, resized_image_path, cookiefied_image_path)
        return generate_recipe(client, cookiefied_image_path)


#print(generate_cookie_recipe("squash.jpg"))

# as if it were a flat cookie
# interaction = client.interactions.create(
#     model="gemini-3.1-flash-lite-image",
#     input="Create a picture of flat apple slice-shaped cookies",
# )

# with open("generated_image.png", "wb") as f:
#     f.write(base64.b64decode(interaction.output_image.data))


# interaction = client.interactions.create(
#     model="gemini-3.8-flash",
#     input="Generate a recipe for a sugar cookie"
# )
# print(interaction.output_text)
