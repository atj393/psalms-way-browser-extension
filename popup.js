// Define the range of chapters available and the path to the data file
const CHAPTER_RANGE = { min: 0, max: 149 };
const DATA_FILE_PATH = "psalms.json";

// Cache for the Psalms data to avoid repeatedly fetching the same file
let cachedData = null;

// Fetch Psalms data from the packaged JSON file. The data is cached so
// subsequent calls do not repeatedly read the same file.
async function fetchData(filePath) {
  if (cachedData) {
    return cachedData;
  }

  try {
    // Resolve the file URL in case this runs inside a browser extension
    let url = filePath;
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) {
      url = chrome.runtime.getURL(filePath);
    }

    const response = await fetch(url);
    cachedData = await response.json();
    return cachedData;
  } catch (error) {
    console.error("Error fetching JSON:", error);
    return null;
  }
}

// This function updates the content displayed on the page
async function updateContent(isVerse = false, chapterIndex = getRandomChapterIndex()) {
  console.log("--->   chapterIndex:", chapterIndex)
  // Fetch the data from the file
  const data = await fetchData(DATA_FILE_PATH);
  // If no data was fetched, stop execution of the function
  if (!data) return;

  // Get the content for the selected chapter
  const chapterContent = data[chapterIndex];

  // Update the current chapter
  currentChapter = chapterIndex;
  // Define the chapter title based on the chapter index
  let chapterTitle = `Psalms ${chapterIndex + 1}`;
  // Create a new div for the content
  const contentDiv = document.createElement("div");
  // If displaying a verse, create a p element and append it to the div
  if (isVerse) {
    // Create a p element for the verse text
    const verse = document.createElement("p");
    // Get a random verse index and set the verse text
    const verseIndex = getRandomVerseIndex(chapterContent);
    // Update the chapter title to include the verse number
    chapterTitle = `${chapterTitle}:${verseIndex + 1}`;
    verse.textContent = chapterContent[verseIndex];
    contentDiv.appendChild(verse);
  } else {
    // If displaying a chapter, create a ul element and append li elements for each verse
    const ul = document.createElement("ul");
    chapterContent.forEach(verseText => {
      const li = document.createElement("li");
      li.textContent = verseText;
      ul.appendChild(li);
    });
    contentDiv.appendChild(ul);
  }

    // Update the chapter title and reset the input field
    document.getElementById("chapterTitle").textContent = chapterTitle;
    document.getElementById("txtChapter").value = "";

  // Replace the existing content with the new content
  const contentSection = document.getElementById("contentElement");
  if (contentSection) contentSection.replaceChildren(contentDiv);
}

// These functions return a random index for a chapter or verse
function getRandomChapterIndex() {
  return Math.floor(Math.random() * (CHAPTER_RANGE.max - CHAPTER_RANGE.min + 1)) + CHAPTER_RANGE.min;
}

function getRandomVerseIndex(chapterContent) {
  return Math.floor(Math.random() * chapterContent.length);
}

// This function sets up event listeners for the UI elements
function initializeEventListeners() {
  // Update the content when the chapter or verse buttons are clicked
  document.getElementById("btnChapter").addEventListener("click", () => updateContent());
  document.getElementById("btnVerse").addEventListener("click", () => updateContent(true));
  // Update the content and current chapter when the prev or next buttons are clicked
  document.getElementById("btnPrev").addEventListener("click", () => {
    currentChapter = currentChapter === CHAPTER_RANGE.min ? CHAPTER_RANGE.max : currentChapter - 1;
    updateContent(false, currentChapter);
  });
  document.getElementById("btnNext").addEventListener("click", () => {
    currentChapter = currentChapter === CHAPTER_RANGE.max ? CHAPTER_RANGE.min : currentChapter + 1;
    updateContent(false, currentChapter);
  });
  // Update the content to a specific chapter when the go button is clicked
  document.getElementById("btnGo").addEventListener("click", () => {
    let chapterNum = parseInt(document.getElementById("txtChapter").value, 10) - 1;
    if (!isNaN(chapterNum) && chapterNum >= CHAPTER_RANGE.min && chapterNum <= CHAPTER_RANGE.max) {
      console.log("--->   chapterNum:", chapterNum)
      updateContent(false, chapterNum);
    } else {
      alert("Please enter a valid chapter number between 1 and 150.");
    }
  });
}

// This variable keeps track of the current chapter
let currentChapter = getRandomChapterIndex();

// When the document is loaded, display a random chapter and set up the event listeners
document.addEventListener("DOMContentLoaded", () => {
  updateContent();
  initializeEventListeners();
});