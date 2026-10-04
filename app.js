const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

const dropzone = document.querySelector("#dropzone");
const fileInput = document.querySelector("#file-input");
const emptyState = document.querySelector("#empty-state");
const previewState = document.querySelector("#preview-state");
const imagePreview = document.querySelector("#image-preview");
const fileDetails = document.querySelector("#file-details");
const fileName = document.querySelector("#file-name");
const fileSize = document.querySelector("#file-size");
const errorMessage = document.querySelector("#error-message");
const removeButton = document.querySelector("#remove-button");
const changeButton = document.querySelector("#change-button");
const uploadButton = document.querySelector("#upload-button");
const resetButton = document.querySelector("#reset-button");
const uploadStatus = document.querySelector("#upload-status");
const recipePanel = document.querySelector("#recipe-panel");
const recipeLoading = document.querySelector("#recipe-loading");
const recipeText = document.querySelector("#recipe-text");

let previewUrl = null;
let selectedFile = null;
let uploadedImageIds = new Set();
let isResetting = false;
let isUploading = false;

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function clearError() {
  errorMessage.textContent = "";
  errorMessage.hidden = true;
}

function clearRecipe() {
  recipeText.textContent = "";
  recipeText.hidden = true;
  recipeLoading.hidden = true;
  recipePanel.hidden = true;
  recipePanel.setAttribute("aria-busy", "false");
}

function updateResetButton() {
  resetButton.hidden = !selectedFile && uploadedImageIds.size === 0;
}

function clearPreview() {
  clearRecipe();
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }

  imagePreview.removeAttribute("src");
  previewState.hidden = true;
  emptyState.hidden = false;
  fileDetails.hidden = true;
  uploadButton.hidden = true;
  uploadButton.disabled = false;
  uploadButton.textContent = "Send image to backend";
  uploadStatus.hidden = true;
  uploadStatus.textContent = "";
  selectedFile = null;
  updateResetButton();
}

function displayFile(file) {
  if (isResetting || isUploading) {
    return;
  }

  clearError();

  if (!file) {
    return;
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    showError("That file type isn’t supported. Choose a JPG, PNG, WEBP, GIF, or AVIF image.");
    return;
  }

  if (file.size > MAX_FILE_SIZE) {
    showError("That image is too large. Please choose a file under 10 MB.");
    return;
  }

  clearPreview();
  previewUrl = URL.createObjectURL(file);
  imagePreview.src = previewUrl;
  emptyState.hidden = true;
  previewState.hidden = false;
  fileDetails.hidden = false;
  uploadButton.hidden = false;
  selectedFile = file;
  updateResetButton();
  fileName.textContent = file.name;
  fileSize.textContent = formatFileSize(file.size);
}

async function uploadSelectedFile() {
  if (!selectedFile || uploadButton.disabled || isUploading) {
    return;
  }

  clearError();
  uploadStatus.hidden = true;
  recipeText.textContent = "";
  recipeText.hidden = true;
  recipeLoading.hidden = false;
  recipePanel.hidden = false;
  recipePanel.setAttribute("aria-busy", "true");
  isUploading = true;
  uploadButton.disabled = true;
  uploadButton.textContent = "Creating recipe…";
  resetButton.disabled = true;
  changeButton.disabled = true;
  removeButton.disabled = true;

  try {
    const response = await fetch("/upload", {
      method: "POST",
      headers: {
        "Content-Type": selectedFile.type,
      },
      body: selectedFile,
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("The backend returned an invalid response.");
    }

    if (!response.ok) {
      throw new Error(result.error || "The server could not receive this image.");
    }

    if (typeof result.upload_id !== "string" || !/^[0-9a-f]{32}$/.test(result.upload_id)) {
      throw new Error("The backend did not return a valid image ID for cleanup.");
    }

    if (typeof result.recipe !== "string" || !result.recipe.trim()) {
      throw new Error("The backend did not return a cookie recipe.");
    }

    uploadedImageIds.add(result.upload_id);
    updateResetButton();
    recipeText.textContent = result.recipe;
    recipeText.hidden = false;
    recipeLoading.hidden = true;
    recipePanel.setAttribute("aria-busy", "false");
    uploadButton.textContent = "Image received";
    uploadStatus.textContent = `Recipe generated from your image (${formatFileSize(result.size)}).`;
    uploadStatus.hidden = false;
  } catch (error) {
    clearRecipe();
    showError(error instanceof TypeError
      ? "Could not reach the backend. Start it with “python test.py” and open this page at http://127.0.0.1:8000."
      : error.message);
  } finally {
    isUploading = false;
    uploadButton.disabled = false;
    uploadButton.textContent = uploadedImageIds.size > 0
      ? "Image received"
      : "Send image to backend";
    resetButton.disabled = false;
    changeButton.disabled = false;
    removeButton.disabled = false;
  }
}

async function resetApp() {
  if (isResetting || isUploading) {
    return;
  }

  clearError();
  isResetting = true;
  resetButton.disabled = true;
  resetButton.textContent = "Deleting uploaded images…";
  uploadButton.disabled = true;
  changeButton.disabled = true;
  removeButton.disabled = true;

  try {
    const results = await Promise.all(
      [...uploadedImageIds].map(async (uploadId) => {
        try {
          const response = await fetch(`/upload/${uploadId}`, { method: "DELETE" });
          if (response.status === 404) {
            return { uploadId };
          }

          let result;
          try {
            result = await response.json();
          } catch {
            throw new Error("The backend returned an invalid response while deleting an image.");
          }

          if (!response.ok) {
            throw new Error(result.error || "The backend could not delete an uploaded image.");
          }

          return { uploadId };
        } catch (error) {
          return { uploadId, error };
        }
      }),
    );

    const failedDeletions = results.filter((result) => result.error);
    for (const result of results) {
      if (!result.error) {
        uploadedImageIds.delete(result.uploadId);
      }
    }

    if (failedDeletions.length > 0) {
      throw failedDeletions[0].error;
    }
  } catch (error) {
    showError(error instanceof TypeError
      ? "Could not reach the backend, so uploaded images could not be deleted. Start the server and try again."
      : error.message);
    return;
  } finally {
    isResetting = false;
    resetButton.disabled = false;
    resetButton.textContent = "Start over";
    uploadButton.disabled = false;
    changeButton.disabled = false;
    removeButton.disabled = false;
  }

  clearPreview();
  fileInput.value = "";
  clearError();
  updateResetButton();
}

function openFilePicker() {
  fileInput.click();
}

dropzone.addEventListener("click", (event) => {
  if (isResetting || isUploading) {
    return;
  }

  openFilePicker();
});

dropzone.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target === dropzone) {
    event.preventDefault();
    openFilePicker();
  }
});

fileInput.addEventListener("change", () => {
  displayFile(fileInput.files[0]);
});

changeButton.addEventListener("click", (event) => {
  event.stopPropagation();
  openFilePicker();
});

removeButton.addEventListener("click", () => {
  clearPreview();
  clearError();
  fileInput.value = "";
});

uploadButton.addEventListener("click", uploadSelectedFile);

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("is-dragging");
});

dropzone.addEventListener("dragleave", (event) => {
  if (!dropzone.contains(event.relatedTarget)) {
    dropzone.classList.remove("is-dragging");
  }
});

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("is-dragging");
  if (isResetting) {
    return;
  }

  displayFile(event.dataTransfer.files[0]);
});

resetButton.addEventListener("click", resetApp);
