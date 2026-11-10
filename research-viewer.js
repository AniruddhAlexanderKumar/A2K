const reader = document.getElementById("researchPdfReader");

if (reader) {
  const pagesElement = reader.querySelector("[data-pdf-pages]");
  const statusElement = reader.querySelector("[data-pdf-status]");
  const pageInput = reader.querySelector("[data-pdf-page]");
  const totalPageElements = [
    reader.querySelector("[data-pdf-total]"),
    document.querySelector("[data-pdf-total-label]")
  ];
  const previousPageButton = reader.querySelector("[data-pdf-previous-page]");
  const nextPageButton = reader.querySelector("[data-pdf-next-page]");
  const zoomLevel = reader.querySelector("[data-pdf-zoom-level]");
  const progressElement = reader.querySelector("[data-pdf-progress]");
  const searchForm = reader.querySelector("[data-pdf-search]");
  const searchInput = reader.querySelector("[data-pdf-search-input]");
  const searchStatus = reader.querySelector("[data-pdf-search-status]");
  const searchPreviousButton = reader.querySelector("[data-pdf-search-previous]");
  const searchNextButton = reader.querySelector("[data-pdf-search-next]");
  const fullscreenButton = reader.querySelector("[data-pdf-fullscreen]");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let pdfDocument;
  let pdfjs;
  let pageRecords = [];
  let currentPage = 1;
  let zoom = 1;
  let renderStarted = false;
  let scrollFrame = 0;
  let searchTimer = 0;
  let searchRequest = 0;
  let searchMatches = [];
  let activeMatch = -1;

  function setStatus(message, isError = false) {
    statusElement.textContent = message;
    statusElement.classList.toggle("is-error", isError);
    statusElement.hidden = !message;
  }

  function setSearchStatus(message) {
    searchStatus.textContent = message;
    searchPreviousButton.disabled = !searchMatches.length;
    searchNextButton.disabled = !searchMatches.length;
  }

  function updateControls() {
    pageInput.value = String(currentPage);
    pageInput.max = String(pageRecords.length);
    previousPageButton.disabled = currentPage <= 1;
    nextPageButton.disabled = currentPage >= pageRecords.length;
    const percentage = Math.round(zoom * 100);
    zoomLevel.textContent = zoom === 1 ? "Fit" : `${percentage}%`;
    reader.querySelector("[data-pdf-zoom-out]").disabled = zoom <= 0.6;
    reader.querySelector("[data-pdf-zoom-in]").disabled = zoom >= 2.5;
  }

  function updateProgress() {
    if (!pageRecords.length) return;

    const readerBounds = reader.getBoundingClientRect();
    const toolbarBottom = reader.querySelector(".research-pdf-toolbar").getBoundingClientRect().bottom;
    let progress = 0;

    if (readerBounds.bottom <= 0) {
      progress = 100;
    } else if (readerBounds.top < window.innerHeight) {
      let activeIndex = 0;
      const anchor = Math.max(toolbarBottom + 12, 0);

      for (let index = 0; index < pageRecords.length; index++) {
        if (pageRecords[index].element.getBoundingClientRect().top <= anchor) activeIndex = index;
        else break;
      }

      const activeBounds = pageRecords[activeIndex].element.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (anchor - activeBounds.top) / activeBounds.height));
      progress = ((activeIndex + fraction) / pageRecords.length) * 100;
      currentPage = activeIndex + 1;
    }

    progress = Math.round(progress * 10) / 10;
    progressElement.setAttribute("aria-valuenow", String(Math.round(progress)));
    progressElement.setAttribute("aria-valuetext", `${Math.round(progress)}% read`);
    progressElement.querySelector("span").style.width = `${progress}%`;
    updateControls();
  }

  function scheduleProgressUpdate() {
    renderNearbyPages();
    if (scrollFrame) return;
    scrollFrame = window.requestAnimationFrame(() => {
      scrollFrame = 0;
      updateProgress();
      renderNearbyPages();
    });
  }

  function renderNearbyPages() {
    if (!pageRecords.length) return;
    for (const record of pageRecords) {
      const bounds = record.element.getBoundingClientRect();
      const isNearViewport = bounds.bottom > -1200 && bounds.top < window.innerHeight + 1200;
      if (isNearViewport) renderPage(record);
      else if (Math.abs(record.number - currentPage) > 2) releasePage(record);
    }
  }

  function pageWidth(record) {
    const availableWidth = Math.max(180, pagesElement.clientWidth - 38);
    const fitWidth = Math.min(920, availableWidth);
    const width = fitWidth * zoom;
    record.element.style.width = `${width}px`;
    record.element.style.aspectRatio = `${record.width} / ${record.height}`;
  }

  function createPlaceholder(pageNumber) {
    const placeholder = document.createElement("span");
    placeholder.className = "research-pdf-placeholder";
    placeholder.textContent = `Loading page ${pageNumber}`;
    return placeholder;
  }

  function releasePage(record) {
    if (!record.rendered && !record.renderTask) return;
    record.generation++;
    record.renderTask?.cancel();
    record.renderTask = null;
    record.renderPromise = null;
    record.rendered = false;
    record.element.querySelectorAll(".pdf-search-highlight").forEach(highlight => highlight.remove());
    record.element.classList.remove("is-error");
    record.element.replaceChildren(record.placeholder);
  }

  function drawSearchHighlights(match, record) {
    record.element.querySelectorAll(".pdf-search-highlight").forEach(highlight => highlight.remove());
    const cssWidth = Math.max(120, record.element.clientWidth - 2);
    const viewport = record.page.getViewport({ scale: cssWidth / record.width });
    for (const segment of match.segments) {
      const transform = pdfjs.Util.transform(viewport.transform, segment.item.transform);
      const height = Math.max(segment.item.height * viewport.scale, Math.hypot(transform[2], transform[3]));
      const highlight = document.createElement("span");
      highlight.className = "pdf-search-highlight";
      highlight.setAttribute("aria-hidden", "true");
      highlight.style.left = `${transform[4]}px`;
      highlight.style.top = `${transform[5] - height}px`;
      highlight.style.width = `${Math.max(segment.item.width * viewport.scale, 2)}px`;
      highlight.style.height = `${height}px`;
      record.element.append(highlight);
    }
  }

  async function renderPage(record, force = false) {
    if (record.renderPromise && !force) return record.renderPromise;
    if (record.rendered && !force) return;

    if (force) record.renderTask?.cancel();
    const generation = ++record.generation;
    record.element.dataset.renderState = "preparing";
    pageWidth(record);
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", `Page ${record.number} of ${pageRecords.length}`);
    record.element.classList.remove("is-error");
    record.element.replaceChildren(canvas, record.placeholder);

    const renderPromise = (async () => {
      try {
        const page = record.page || await pdfDocument.getPage(record.number);
        const cssWidth = Math.max(120, record.element.clientWidth - 2);
        const viewport = page.getViewport({ scale: cssWidth / record.width });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const context = canvas.getContext("2d", { alpha: false });

        canvas.width = Math.ceil(viewport.width * outputScale);
        canvas.height = Math.ceil(viewport.height * outputScale);
        canvas.style.width = "100%";
        canvas.style.height = "100%";

        const task = page.render({
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
          background: "#ffffff"
        });
        record.renderTask = task;
        record.element.dataset.renderState = "rendering";
        await task.promise;

        if (generation !== record.generation) return;
        record.placeholder.remove();
        record.rendered = true;
        record.element.dataset.renderState = "rendered";
        const highlightedMatch = searchMatches[activeMatch];
        if (highlightedMatch?.page === record.number) drawSearchHighlights(highlightedMatch, record);
      } catch (error) {
        if (generation !== record.generation || error?.name === "RenderingCancelledException") return;
        record.element.classList.add("is-error");
        record.element.dataset.renderState = "failed";
        record.placeholder.textContent = `Page ${record.number} could not be rendered.`;
        setStatus(`Page ${record.number} could not be rendered. Try reloading the paper.`, true);
      } finally {
        if (generation === record.generation) record.renderTask = null;
      }
    })();

    record.renderPromise = renderPromise;
    await renderPromise;
    if (record.renderPromise === renderPromise) record.renderPromise = null;
  }

  function scrollToPage(pageNumber) {
    if (!pageRecords.length) return;
    const number = Math.max(1, Math.min(pageRecords.length, Number(pageNumber) || 1));
    const record = pageRecords[number - 1];
    const toolbarHeight = reader.querySelector(".research-pdf-toolbar").getBoundingClientRect().height;
    const pageBounds = record.element.getBoundingClientRect();
    const behavior = reduceMotion ? "auto" : "smooth";

    if (document.fullscreenElement === reader) {
      reader.scrollTo({
        top: reader.scrollTop + pageBounds.top - toolbarHeight - 12,
        behavior
      });
    } else {
      window.scrollTo({
        top: window.scrollY + pageBounds.top - toolbarHeight - 12,
        behavior
      });
    }

    currentPage = number;
    updateControls();
  }

  function updateRenderedPages() {
    for (const record of pageRecords) {
      pageWidth(record);
      if (record.rendered || record.renderTask) renderPage(record, true);
    }
  }

  async function findMatches() {
    const request = ++searchRequest;
    const query = searchInput.value.trim().toLocaleLowerCase();
    searchMatches = [];
    activeMatch = -1;
    clearSearchHighlights();

    if (!query) {
      setSearchStatus("");
      return;
    }

    setSearchStatus("Searching…");

    try {
      for (const record of pageRecords) {
        if (request !== searchRequest) return;

        if (!record.text) {
          const content = await record.page.getTextContent();
          let text = "";
          record.textSegments = content.items
            .filter(item => typeof item.str === "string" && item.str.length)
            .map(item => {
              if (text) text += " ";
              const start = text.length;
              text += item.str;
              return { start, end: text.length, item };
            });
          record.text = text.toLocaleLowerCase();
        }

        let offset = record.text.indexOf(query);
        while (offset !== -1) {
          const end = offset + query.length;
          const segments = record.textSegments.filter(segment => segment.end > offset && segment.start < end);
          searchMatches.push({ page: record.number, offset, segments });
          offset = record.text.indexOf(query, offset + query.length);
        }

        if (record.number % 4 === 0) {
          setSearchStatus(`Searching ${record.number}/${pageRecords.length}…`);
          await new Promise(resolve => window.setTimeout(resolve, 0));
        }
      }

      if (request !== searchRequest) return;
      if (!searchMatches.length) {
        setSearchStatus("No matches");
        return;
      }

      activeMatch = 0;
      showMatch();
    } catch (error) {
      if (request === searchRequest) setSearchStatus("Search failed");
      console.error("Could not search the research paper.", error);
    }
  }

  function clearSearchHighlights() {
    for (const record of pageRecords) {
      record.element.querySelectorAll(".pdf-search-highlight").forEach(highlight => highlight.remove());
    }
  }

  async function showMatch() {
    if (!searchMatches.length) return;
    const matchIndex = activeMatch;
    const match = searchMatches[matchIndex];
    const record = pageRecords[match.page - 1];
    clearSearchHighlights();
    scrollToPage(match.page);
    setSearchStatus(`Match ${activeMatch + 1} of ${searchMatches.length} · page ${match.page}`);
    await renderPage(record);
    if (activeMatch !== matchIndex || !record.rendered) return;
    drawSearchHighlights(match, record);
  }

  function moveMatch(direction) {
    if (!searchMatches.length) return;
    activeMatch = (activeMatch + direction + searchMatches.length) % searchMatches.length;
    showMatch();
  }

  async function initializeReader() {
    if (renderStarted) return;
    renderStarted = true;
    setStatus("Loading the research paper…");

    try {
      pdfjs = await import("./assets/vendor/pdfjs/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("assets/vendor/pdfjs/pdf.worker.mjs", document.baseURI).href;

      const loadingTask = pdfjs.getDocument({
        url: new URL("assets/research/aerospace-supply-chain-disruption.pdf", document.baseURI).href,
        cMapUrl: new URL("assets/vendor/pdfjs/cmaps/", document.baseURI).href,
        cMapPacked: true,
        standardFontDataUrl: new URL("assets/vendor/pdfjs/standard_fonts/", document.baseURI).href,
        wasmUrl: new URL("assets/vendor/pdfjs/wasm/", document.baseURI).href,
        iccUrl: new URL("assets/vendor/pdfjs/iccs/", document.baseURI).href,
        isEvalSupported: false
      });

      pdfDocument = await loadingTask.promise;
      const pageCount = pdfDocument.numPages;
      for (const element of totalPageElements) element.textContent = String(pageCount);

      const dimensions = await Promise.all(Array.from({ length: pageCount }, async (_, index) => {
        const page = await pdfDocument.getPage(index + 1);
        const viewport = page.getViewport({ scale: 1 });
        return { number: index + 1, width: viewport.width, height: viewport.height, page };
      }));

      const fragment = document.createDocumentFragment();
      pageRecords = dimensions.map(({ number, width, height }) => {
        const element = document.createElement("div");
        element.className = "research-pdf-page";
        element.dataset.pageNumber = String(number);
        const placeholder = createPlaceholder(number);
        const record = {
          number,
          width,
          height,
          page: dimensions[number - 1].page,
          element,
          placeholder,
          generation: 0,
          rendered: false,
          renderTask: null,
          renderPromise: null,
          text: "",
          textSegments: []
        };
        pageWidth(record);
        element.append(placeholder);
        fragment.append(element);
        return record;
      });

      pagesElement.replaceChildren(fragment);
      updateControls();
      setStatus(`The ${pageCount}-page paper is ready. Pages render as you scroll.`);
      updateProgress();
      renderNearbyPages();
    } catch (error) {
      console.error("Could not load the research paper.", error);
      setStatus("The research paper could not be loaded. Please try again later.", true);
      const openLink = document.createElement("a");
      openLink.href = new URL("assets/research/aerospace-supply-chain-disruption.pdf", document.baseURI).href;
      openLink.textContent = "Open the original PDF";
      openLink.target = "_blank";
      openLink.rel = "noopener noreferrer";
      statusElement.append(" ", openLink);
    }
  }

  previousPageButton.addEventListener("click", () => scrollToPage(currentPage - 1));
  nextPageButton.addEventListener("click", () => scrollToPage(currentPage + 1));
  pageInput.addEventListener("change", () => scrollToPage(pageInput.value));
  pageInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      scrollToPage(pageInput.value);
      pageInput.blur();
    }
  });
  reader.querySelector("[data-pdf-zoom-in]").addEventListener("click", () => {
    zoom = Math.min(2.5, Math.round((zoom + 0.15) * 100) / 100);
    updateControls();
    updateRenderedPages();
  });
  reader.querySelector("[data-pdf-zoom-out]").addEventListener("click", () => {
    zoom = Math.max(0.6, Math.round((zoom - 0.15) * 100) / 100);
    updateControls();
    updateRenderedPages();
  });
  reader.querySelector("[data-pdf-fit]").addEventListener("click", () => {
    zoom = 1;
    updateControls();
    updateRenderedPages();
  });
  searchForm.addEventListener("submit", event => {
    event.preventDefault();
    window.clearTimeout(searchTimer);
    findMatches();
  });
  searchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(findMatches, 300);
  });
  searchPreviousButton.addEventListener("click", () => moveMatch(-1));
  searchNextButton.addEventListener("click", () => moveMatch(1));
  fullscreenButton.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement === reader) await document.exitFullscreen();
      else await reader.requestFullscreen();
    } catch (error) {
      setStatus("Fullscreen mode is unavailable in this browser.", true);
      console.error("Could not change PDF reader fullscreen mode.", error);
    }
  });

  document.addEventListener("fullscreenchange", () => {
    const isFullscreen = document.fullscreenElement === reader;
    fullscreenButton.setAttribute("aria-label", isFullscreen ? "Exit fullscreen" : "Enter fullscreen");
    fullscreenButton.title = isFullscreen ? "Exit fullscreen" : "Enter fullscreen";
    window.setTimeout(() => {
      updateRenderedPages();
      scheduleProgressUpdate();
    }, 50);
  });

  window.addEventListener("scroll", scheduleProgressUpdate, { passive: true });
  reader.addEventListener("scroll", scheduleProgressUpdate, { passive: true });
  window.addEventListener("resize", () => {
    updateRenderedPages();
    scheduleProgressUpdate();
  }, { passive: true });

  function initializeWhenNearReader() {
    if (renderStarted) return;
    const bounds = reader.getBoundingClientRect();
    if (bounds.top < window.innerHeight + 600 && bounds.bottom > -600) {
      window.removeEventListener("scroll", initializeWhenNearReader);
      initializeReader();
    }
  }

  window.addEventListener("scroll", initializeWhenNearReader, { passive: true });
  window.setTimeout(initializeWhenNearReader, 300);
}
