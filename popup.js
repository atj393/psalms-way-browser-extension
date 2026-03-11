const CHAPTER_RANGE = { min: 0, max: 149 };
const DATA_FILE_PATH = "psalms.json";

// Cache psalms data so we only fetch once per popup session
let psalmsData = null;

async function getData() {
  if (psalmsData) return psalmsData;
  try {
    const response = await fetch(DATA_FILE_PATH);
    psalmsData = await response.json();
    return psalmsData;
  } catch (error) {
    console.error("Error loading psalms data:", error);
    return null;
  }
}

async function updateContent(isVerse = false, chapterIndex = getRandomChapterIndex()) {
  const data = await getData();
  if (!data) return;

  currentChapter = chapterIndex;
  const chapterContent = data[chapterIndex];
  const baseTitle = `Psalms ${chapterIndex + 1}`;
  const contentDiv = document.createElement("div");

  if (isVerse) {
    const verseIndex = getRandomVerseIndex(chapterContent);
    const verse = document.createElement("p");
    verse.textContent = chapterContent[verseIndex];
    contentDiv.appendChild(verse);
    document.getElementById("chapterTitle").textContent = `${baseTitle}:${verseIndex + 1}`;
  } else {
    const ul = document.createElement("ul");
    chapterContent.forEach(verseText => {
      const li = document.createElement("li");
      li.textContent = verseText;
      ul.appendChild(li);
    });
    contentDiv.appendChild(ul);
    document.getElementById("chapterTitle").textContent = baseTitle;
  }

  document.getElementById("txtChapter").value = "";
  document.getElementById("contentElement").replaceChildren(contentDiv);
}

function getRandomChapterIndex() {
  return Math.floor(Math.random() * (CHAPTER_RANGE.max - CHAPTER_RANGE.min + 1)) + CHAPTER_RANGE.min;
}

function getRandomVerseIndex(chapterContent) {
  return Math.floor(Math.random() * chapterContent.length);
}

function goToChapter() {
  const chapterNum = parseInt(document.getElementById("txtChapter").value, 10) - 1;
  if (!isNaN(chapterNum) && chapterNum >= CHAPTER_RANGE.min && chapterNum <= CHAPTER_RANGE.max) {
    updateContent(false, chapterNum);
  } else {
    alert("Please enter a valid chapter number between 1 and 150.");
  }
}

function initializeEventListeners() {
  document.getElementById("btnChapter").addEventListener("click", () => updateContent());
  document.getElementById("btnVerse").addEventListener("click", () => updateContent(true));
  document.getElementById("btnPrev").addEventListener("click", () => {
    currentChapter = currentChapter === CHAPTER_RANGE.min ? CHAPTER_RANGE.max : currentChapter - 1;
    updateContent(false, currentChapter);
  });
  document.getElementById("btnNext").addEventListener("click", () => {
    currentChapter = currentChapter === CHAPTER_RANGE.max ? CHAPTER_RANGE.min : currentChapter + 1;
    updateContent(false, currentChapter);
  });
  document.getElementById("btnGo").addEventListener("click", goToChapter);
  document.getElementById("txtChapter").addEventListener("keydown", (e) => {
    if (e.key === "Enter") goToChapter();
  });
}

let currentChapter = 0;

document.addEventListener("DOMContentLoaded", () => {
  currentChapter = getRandomChapterIndex();
  updateContent(false, currentChapter);
  initializeEventListeners();
});
