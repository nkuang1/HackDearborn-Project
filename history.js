const historyGrid = document.querySelector("#history-grid");
const historyMessage = document.querySelector("#history-message");

function makeHistoryCard(entry) {
  const card = document.createElement("article");
  card.className = "history-card";

  const image = document.createElement("img");
  image.className = "history-image";
  image.src = `/cookie/${entry.upload_id}`;
  image.alt = "Generated cookie";
  image.loading = "lazy";
  image.addEventListener("error", () => {
    image.classList.add("history-image-unavailable");
    image.alt = "Generated cookie image is unavailable";
    image.removeAttribute("src");
  }, { once: true });

  const content = document.createElement("div");
  content.className = "history-card-content";

  const date = document.createElement("p");
  date.className = "history-date";
  const timestamp = new Date(entry.created_at);
  date.textContent = Number.isNaN(timestamp.getTime())
    ? "Created this session"
    : `Created ${timestamp.toLocaleString()}`;

  const recipe = document.createElement("div");
  recipe.className = "recipe-text history-recipe";
  recipe.append(renderRecipeMarkdown(entry.recipe));

  content.append(date, recipe);
  card.append(image, content);
  return card;
}

async function loadHistory() {
  try {
    const response = await fetch("/api/history", { cache: "no-store" });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("The server returned an invalid history response.");
    }

    if (!response.ok) {
      throw new Error(result.error || "Could not load your recent creations.");
    }

    if (!Array.isArray(result.entries)) {
      throw new Error("The server returned an invalid history response.");
    }

    historyGrid.replaceChildren();
    if (result.entries.length === 0) {
      historyMessage.textContent = "No creations yet. Upload an image to make your first cookie.";
      return;
    }

    for (const entry of result.entries) {
      if (
        typeof entry.upload_id !== "string"
        || !/^[0-9a-f]{32}$/.test(entry.upload_id)
        || typeof entry.recipe !== "string"
        || typeof entry.created_at !== "string"
      ) {
        continue;
      }

      historyGrid.append(makeHistoryCard(entry));
    }

    historyMessage.textContent = historyGrid.childElementCount > 0
      ? `${historyGrid.childElementCount} ${historyGrid.childElementCount === 1 ? "creation" : "creations"} this session`
      : "No creations yet. Upload an image to make your first cookie.";
  } catch (error) {
    historyMessage.textContent = error instanceof TypeError
      ? "Could not connect to the server. Start it with “python test.py” and try again."
      : error.message;
    historyMessage.classList.add("history-message-error");
  }
}

loadHistory();
