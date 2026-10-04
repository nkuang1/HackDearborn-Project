function appendInlineMarkdown(container, text) {
  const inlinePattern = /(\*\*.+?\*\*|__.+?__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(inlinePattern)) {
    const token = match[0];
    const index = match.index;
    if (index > lastIndex) {
      container.append(document.createTextNode(text.slice(lastIndex, index)));
    }

    const isBold = token.startsWith("**") || token.startsWith("__");
    const isCode = token.startsWith("`");
    const delimiterSize = isBold ? 2 : 1;
    const content = token.slice(delimiterSize, -delimiterSize);
    const element = document.createElement(isBold ? "strong" : isCode ? "code" : "em");
    element.textContent = content;
    container.append(element);
    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) {
    container.append(document.createTextNode(text.slice(lastIndex)));
  }
}

function renderRecipeMarkdown(markdown) {
  const fragment = document.createDocumentFragment();
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let paragraphLines = [];
  let list = null;
  let listType = null;
  let orderedListStart = 1;

  function flushParagraph() {
    if (paragraphLines.length === 0) {
      return;
    }

    const paragraph = document.createElement("p");
    appendInlineMarkdown(paragraph, paragraphLines.join(" "));
    fragment.append(paragraph);
    paragraphLines = [];
  }

  function closeList() {
    list = null;
    listType = null;
  }

  function appendListItem(text, type, start = 1) {
    flushParagraph();
    if (listType !== type) {
      closeList();
      listType = type;
      list = document.createElement(type === "ordered" ? "ol" : "ul");
      if (type === "ordered" && start !== 1) {
        list.start = start;
      }
      fragment.append(list);
    }

    const item = document.createElement("li");
    appendInlineMarkdown(item, text);
    list.append(item);
  }

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = trimmedLine.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      flushParagraph();
      closeList();
      const element = document.createElement(heading[1].length <= 2 ? "h3" : "h4");
      appendInlineMarkdown(element, heading[2]);
      fragment.append(element);
      continue;
    }

    if (/^([-*_])(?:\s*\1){2,}\s*$/.test(trimmedLine)) {
      flushParagraph();
      closeList();
      fragment.append(document.createElement("hr"));
      continue;
    }

    const unorderedItem = trimmedLine.match(/^[-*+]\s+(.+)$/);
    if (unorderedItem) {
      appendListItem(unorderedItem[1], "unordered");
      continue;
    }

    const orderedItem = trimmedLine.match(/^(\d+)[.)]\s+(.+)$/);
    if (orderedItem) {
      const start = listType === "ordered" ? orderedListStart : Number(orderedItem[1]);
      appendListItem(orderedItem[2], "ordered", start);
      orderedListStart = Number(orderedItem[1]) + 1;
      continue;
    }

    closeList();
    paragraphLines.push(trimmedLine);
  }

  flushParagraph();
  return fragment;
}
