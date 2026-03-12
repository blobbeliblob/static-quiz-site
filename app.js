(function () {
  "use strict";

  const SCHEMA_VERSION = "1.1.0";
  const QUESTION_TYPES = new Set([
    "text",
    "numerical",
    "multiple_choice",
    "multiple_response"
  ]);

  async function compressQuiz(data) {
    if (typeof CompressionStream !== "function") {
      throw new Error("CompressionStream is not available in this browser");
    }
    const json = JSON.stringify(data);
    const inputBytes = new TextEncoder().encode(json);
    const compressedStream = new CompressionStream("deflate");
    const writer = compressedStream.writable.getWriter();
    writer.write(inputBytes);
    writer.close();
    const compressedBuffer = await new Response(compressedStream.readable).arrayBuffer();
    return new Uint8Array(compressedBuffer).toBase64({alphabet: 'base64url'});
  }

  async function decompressQuiz(encoded) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("DecompressionStream is not available in this browser");
    }
    const compressedBytes = Uint8Array.fromBase64(encoded, {alphabet: 'base64url'});
    const decompressedStream = new DecompressionStream("deflate");
    const writer = decompressedStream.writable.getWriter();
    writer.write(compressedBytes);
    writer.close();
    const decompressedBuffer = await new Response(decompressedStream.readable).arrayBuffer();
    return JSON.parse(new TextDecoder().decode(decompressedBuffer));
  }

  function shuffleArray(items) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  function isNumericValue(value) {
    if (typeof value === "number") {
      return Number.isFinite(value);
    }
    if (typeof value !== "string") {
      return false;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return false;
    }

    return Number.isFinite(Number(trimmed));
  }

  function normalizeHttpsImageUrl(value) {
    if (typeof value !== "string") {
      throw new Error("Image URL must be a string");
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(trimmed);
    } catch {
      throw new Error("Image URL must be a valid absolute URL");
    }

    if (parsedUrl.protocol !== "https:") {
      throw new Error("Image URL must use https");
    }

    if (!parsedUrl.hostname) {
      throw new Error("Image URL must include a hostname");
    }

    if (parsedUrl.username || parsedUrl.password) {
      throw new Error("Image URL cannot include credentials");
    }

    return parsedUrl.href;
  }

  function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function normalizeStringArray(value, fieldName) {
    if (!Array.isArray(value)) {
      throw new Error(fieldName + " must be an array");
    }

    return value
      .map((item) => {
        if (typeof item === "string" || typeof item === "number") {
          return String(item).trim();
        }
        throw new Error(fieldName + " contains an invalid value");
      })
      .filter(Boolean);
  }

  function validateAndNormalizeQuizData(rawQuizData) {
    if (!isPlainObject(rawQuizData)) {
      throw new Error("Quiz payload must be an object");
    }

    if ("sa" in rawQuizData && typeof rawQuizData.sa !== "boolean") {
      throw new Error("Invalid show-answer flag");
    }

    if ("sr" in rawQuizData && typeof rawQuizData.sr !== "boolean") {
      throw new Error("Invalid show-results flag");
    }

    if ("n" in rawQuizData && typeof rawQuizData.n !== "string") {
      throw new Error("Invalid quiz name");
    }

    if ("p" in rawQuizData && typeof rawQuizData.p !== "string") {
      throw new Error("Invalid quiz password");
    }

    if (!Array.isArray(rawQuizData.qs) || rawQuizData.qs.length === 0) {
      throw new Error("Quiz must include at least one question");
    }

    const normalizedQuiz = {
      sv:
        typeof rawQuizData.sv === "string" || typeof rawQuizData.sv === "number"
          ? String(rawQuizData.sv)
          : SCHEMA_VERSION,
      sa: rawQuizData.sa !== false,
      sr: rawQuizData.sr !== false,
      qs: []
    };

    const quizName = typeof rawQuizData.n === "string" ? rawQuizData.n.trim() : "";
    if (quizName) {
      normalizedQuiz.n = quizName;
    }

    const quizPassword = typeof rawQuizData.p === "string" ? rawQuizData.p.trim() : "";
    if (quizPassword) {
      normalizedQuiz.p = quizPassword;
    }

    rawQuizData.qs.forEach((rawQuestion, index) => {
      const questionLabel = "Question " + (index + 1);

      if (!isPlainObject(rawQuestion)) {
        throw new Error(questionLabel + " must be an object");
      }

      const questionText = typeof rawQuestion.q === "string" ? rawQuestion.q.trim() : "";
      if (!questionText) {
        throw new Error(questionLabel + " is missing question text");
      }

      if (!QUESTION_TYPES.has(rawQuestion.t)) {
        throw new Error(questionLabel + " has an invalid type");
      }

      if ("nt" in rawQuestion && typeof rawQuestion.nt !== "string") {
        throw new Error(questionLabel + " has an invalid note");
      }

      if ("i" in rawQuestion && typeof rawQuestion.i !== "string") {
        throw new Error(questionLabel + " has an invalid image URL");
      }

      if ("ia" in rawQuestion && typeof rawQuestion.ia !== "string") {
        throw new Error(questionLabel + " has an invalid image attribution");
      }

      if ("cs" in rawQuestion && typeof rawQuestion.cs !== "boolean") {
        throw new Error(questionLabel + " has an invalid case-sensitivity flag");
      }

      if ("ro" in rawQuestion && typeof rawQuestion.ro !== "boolean") {
        throw new Error(questionLabel + " has an invalid randomize-options flag");
      }

      if ("rac" in rawQuestion && typeof rawQuestion.rac !== "boolean") {
        throw new Error(questionLabel + " has an invalid require-all-correct flag");
      }

      const normalizedQuestion = { q: questionText, t: rawQuestion.t, a: [] };

      const note = typeof rawQuestion.nt === "string" ? rawQuestion.nt.trim() : "";
      if (note) {
        normalizedQuestion.nt = note;
      }

      const image = typeof rawQuestion.i === "string" ? rawQuestion.i.trim() : "";
      if (image) {
        try {
          normalizedQuestion.i = normalizeHttpsImageUrl(image);
        } catch {
          throw new Error(questionLabel + " image URL must be a valid https URL");
        }
      }

      const imageAttribution =
        typeof rawQuestion.ia === "string" ? rawQuestion.ia.trim() : "";
      if (imageAttribution) {
        normalizedQuestion.ia = imageAttribution;
      }

      if (rawQuestion.t === "text") {
        const answers = normalizeStringArray(rawQuestion.a, questionLabel + " answers");
        if (answers.length === 0) {
          throw new Error(questionLabel + " must include at least one accepted answer");
        }

        normalizedQuestion.a = answers;
        normalizedQuestion.cs = rawQuestion.cs === true;
      } else if (rawQuestion.t === "numerical") {
        const answers = normalizeStringArray(rawQuestion.a, questionLabel + " answers");
        if (answers.length === 0 || answers.some((value) => !isNumericValue(value))) {
          throw new Error(questionLabel + " must include valid numerical answers");
        }

        normalizedQuestion.a = answers;
      } else {
        const options = normalizeStringArray(rawQuestion.o, questionLabel + " options");
        const answers = normalizeStringArray(rawQuestion.a, questionLabel + " answers");

        if (options.length < 2) {
          throw new Error(questionLabel + " must include at least two options");
        }

        if (answers.length === 0) {
          throw new Error(questionLabel + " must include at least one correct answer");
        }

        const optionSet = new Set(options.map((option) => option.toLowerCase()));
        if (answers.some((answer) => !optionSet.has(answer.toLowerCase()))) {
          throw new Error(questionLabel + " has answers that are not part of its options");
        }

        if (rawQuestion.t === "multiple_choice" && answers.length !== 1) {
          throw new Error(questionLabel + " must include exactly one correct answer");
        }

        normalizedQuestion.o = options;
        normalizedQuestion.a = answers;
        normalizedQuestion.ro = rawQuestion.ro === true;

        if (rawQuestion.t === "multiple_response") {
          normalizedQuestion.rac = rawQuestion.rac !== false;
        }
      }

      normalizedQuiz.qs.push(normalizedQuestion);
    });

    return normalizedQuiz;
  }

  let pendingCreatorQuizData = null;

  // --- Routing ---
  async function route() {
    const hash = window.location.hash.slice(1);
    if (!hash) {
      pendingCreatorQuizData = null;
      showMainView();
      return;
    }

    if (hash === "create") {
      const prefillQuizData = pendingCreatorQuizData;
      pendingCreatorQuizData = null;
      showCreatorView(prefillQuizData);
      return;
    }

    if (hash === "edit") {
      showMainView();
      showEditOverlay();
      return;
    }

    pendingCreatorQuizData = null;
    await showQuizView(hash);
  }

  function showMainView() {
    hideEditOverlay();
    document.getElementById("main-view").classList.remove("hidden");
    document.getElementById("creator-view").classList.add("hidden");
    document.getElementById("quiz-view").classList.add("hidden");
  }

  function showEditOverlay() {
    const overlay = document.getElementById("edit-overlay");
    const urlInput = document.getElementById("edit-quiz-url-input");
    const passwordInput = document.getElementById("edit-quiz-password-input");
    clearEditOverlayMessage();
    urlInput.value = "";
    passwordInput.value = "";
    overlay.classList.remove("hidden");
    urlInput.focus();
  }

  function hideEditOverlay() {
    document.getElementById("edit-overlay").classList.add("hidden");
  }

  function clearEditOverlayMessage() {
    const message = document.getElementById("edit-overlay-message");
    message.textContent = "";
    message.classList.add("hidden");
    message.classList.remove("error");
  }

  function showEditOverlayMessage(message, isError) {
    const messageElement = document.getElementById("edit-overlay-message");
    messageElement.textContent = message;
    messageElement.classList.remove("hidden");
    messageElement.classList.toggle("error", Boolean(isError));
  }

  function extractQuizHashFromInput(inputValue) {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      throw new Error("Paste the quiz URL you want to edit.");
    }

    if (trimmed.startsWith("#")) {
      const hashValue = trimmed.slice(1).trim();
      if (!hashValue || hashValue === "create" || hashValue === "edit") {
        throw new Error("That link does not contain a quiz payload.");
      }
      return hashValue;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(trimmed);
    } catch {
      throw new Error("Enter a valid quiz URL.");
    }

    const hashValue = parsedUrl.hash.slice(1).trim();
    if (!hashValue || hashValue === "create" || hashValue === "edit") {
      throw new Error("That link does not contain a quiz payload.");
    }

    return hashValue;
  }

  async function submitEditQuizForm(event) {
    event.preventDefault();
    clearEditOverlayMessage();

    const quizUrl = document.getElementById("edit-quiz-url-input").value;
    const enteredPassword = document.getElementById("edit-quiz-password-input").value.trim();

    let encodedHash;
    try {
      encodedHash = extractQuizHashFromInput(quizUrl);
    } catch (error) {
      showEditOverlayMessage(error.message, true);
      return;
    }

    let importedQuiz;
    try {
      const decodedQuiz = await decompressQuiz(encodedHash);
      importedQuiz = validateAndNormalizeQuizData(decodedQuiz);
    } catch {
      showEditOverlayMessage("Could not decode that quiz link. Please check the URL.", true);
      return;
    }

    const expectedPassword = typeof importedQuiz.p === "string" ? importedQuiz.p : "";
    if (expectedPassword && enteredPassword !== expectedPassword) {
      showEditOverlayMessage("Incorrect password for this quiz.", true);
      return;
    }

    pendingCreatorQuizData = importedQuiz;
    hideEditOverlay();
    window.location.hash = "create";
  }

  function cancelEditQuizForm() {
    hideEditOverlay();
    if (window.location.hash.slice(1) === "edit") {
      window.location.hash = "";
    }
  }

  function initEditOverlay() {
    document.getElementById("edit-quiz-form").onsubmit = submitEditQuizForm;
    document.getElementById("edit-overlay-cancel-btn").onclick = cancelEditQuizForm;
    document.getElementById("edit-overlay").onclick = (event) => {
      if (event.target.id === "edit-overlay") {
        cancelEditQuizForm();
      }
    };
  }

  // =============================================
  //  QUIZ CREATOR
  // =============================================
  function showCreatorView(prefillQuizData = null) {
    hideEditOverlay();
    document.getElementById("main-view").classList.add("hidden");
    document.getElementById("creator-view").classList.remove("hidden");
    document.getElementById("quiz-view").classList.add("hidden");
    initCreator(prefillQuizData);
  }

  let questionCount = 0;

  function resetGeneratedLinkOutput() {
    const linkOutput = document.getElementById("link-output");
    const linkMessage = document.getElementById("link-message");
    const linkInput = document.getElementById("quiz-link");
    linkOutput.classList.add("hidden");
    linkMessage.textContent = "";
    linkMessage.classList.add("hidden");
    linkMessage.classList.remove("error");
    linkInput.value = "";
  }

  function initCreator(prefillQuizData = null) {
    document.getElementById("questions-container").innerHTML = "";
    questionCount = 0;
    document.getElementById("quiz-name-input").value = "";
    document.getElementById("quiz-password-input").value = "";
    document.getElementById("show-answer-toggle").checked = true;
    document.getElementById("show-final-results-toggle").checked = true;
    resetGeneratedLinkOutput();

    if (prefillQuizData) {
      document.getElementById("quiz-name-input").value = prefillQuizData.n || "";
      document.getElementById("quiz-password-input").value = prefillQuizData.p || "";
      document.getElementById("show-answer-toggle").checked = prefillQuizData.sa !== false;
      document.getElementById("show-final-results-toggle").checked = prefillQuizData.sr !== false;

      if (Array.isArray(prefillQuizData.qs) && prefillQuizData.qs.length > 0) {
        prefillQuizData.qs.forEach((question) => addQuestion(question));
      } else {
        addQuestion();
      }
    } else {
      addQuestion();
    }

    document.getElementById("add-question-btn").onclick = () => addQuestion();
    document.getElementById("generate-link-btn").onclick = generateLink;
    document.getElementById("copy-link-btn").onclick = copyLink;
  }

  function addQuestion(initialQuestionData = null) {
    questionCount++;
    const idx = questionCount;
    const card = document.createElement("div");
    card.className = "question-card";
    card.dataset.idx = idx;
    card.innerHTML = `
      <h3>Question ${idx}</h3>
      <button class="remove-question-btn" title="Remove">&times;</button>
      <div class="form-group">
        <label>Question</label>
        <textarea class="q-text" placeholder="Enter your question"></textarea>
      </div>
      <div class="form-group">
        <label>Notes (optional)</label>
        <textarea class="q-note" placeholder="Shown after the question is answered"></textarea>
      </div>
      <div class="form-group">
        <label>Image URL (optional)</label>
        <input type="url" class="q-image" placeholder="https://...">
      </div>
      <div class="form-group image-attribution-section hidden">
        <label>Image Attribution (optional)</label>
        <input type="text" class="q-image-attribution" placeholder="Photographer, website, or source URL">
      </div>
      <div class="form-group">
        <label>Type</label>
        <select class="q-type">
          <option value="text">Text</option>
          <option value="numerical">Numerical</option>
          <option value="multiple_choice">Multiple Choice</option>
          <option value="multiple_response">Multiple Response</option>
        </select>
      </div>
      <div class="form-group case-sensitive-section">
        <label>
          <input type="checkbox" class="q-case-sensitive">
          Case-sensitive answers
        </label>
      </div>
      <div class="form-group answer-section">
        <label class="answers-label">Accepted Answer(s)</label>
        <div class="answers-list"></div>
        <button class="add-answer-btn">+ Add Answer</button>
      </div>
      <div class="form-group randomize-options-section hidden">
        <label>
          <input type="checkbox" class="q-randomize-options">
          Randomize option order
        </label>
      </div>
      <div class="form-group mr-all-correct-section hidden">
        <label>
          <input type="checkbox" class="q-require-all-correct" checked>
          Require all correct answers
        </label>
      </div>
      <div class="form-group options-section hidden">
        <label class="options-label">Options (select correct answers)</label>
        <div class="options-list"></div>
        <button class="add-option-btn">+ Add Option</button>
      </div>
    `;

    const container = document.getElementById("questions-container");
    container.appendChild(card);

    // Remove button
    card.querySelector(".remove-question-btn").onclick = () => {
      card.remove();
      renumberQuestions();
    };

    // Type toggle
    const typeSelect = card.querySelector(".q-type");
    typeSelect.onchange = () => toggleType(card, typeSelect.value);

    // Image attribution visibility toggle
    const imageInput = card.querySelector(".q-image");
    imageInput.oninput = () => syncImageAttributionVisibility(card);

    // Add accepted answer
    card.querySelector(".add-answer-btn").onclick = (event) => {
      event.preventDefault();
      addAnswer(card);
    };

    // Add option
    card.querySelector(".add-option-btn").onclick = (event) => {
      event.preventDefault();
      addOption(card);
    };

    if (initialQuestionData) {
      populateQuestionCard(card, initialQuestionData);
    } else {
      // Seed one accepted answer by default
      addAnswer(card);

      // Seed two options for MC
      addOption(card);
      addOption(card);

      toggleType(card, "text");
      syncImageAttributionVisibility(card);
    }
  }

  function populateQuestionCard(card, questionData) {
    card.querySelector(".q-text").value = typeof questionData.q === "string" ? questionData.q : "";
    card.querySelector(".q-note").value =
      typeof questionData.nt === "string" ? questionData.nt : "";
    card.querySelector(".q-image").value =
      typeof questionData.i === "string" ? questionData.i : "";
    card.querySelector(".q-image-attribution").value =
      typeof questionData.ia === "string" ? questionData.ia : "";

    const questionType = QUESTION_TYPES.has(questionData.t) ? questionData.t : "text";
    const typeSelect = card.querySelector(".q-type");
    typeSelect.value = questionType;
    toggleType(card, questionType);

    if (questionType === "text" || questionType === "numerical") {
      const answersList = card.querySelector(".answers-list");
      answersList.innerHTML = "";

      const answers =
        Array.isArray(questionData.a) && questionData.a.length > 0 ? questionData.a : [""];
      answers.forEach((answer) => addAnswer(card, String(answer)));

      if (questionType === "text") {
        card.querySelector(".q-case-sensitive").checked = questionData.cs === true;
      }
    } else {
      card.querySelector(".q-randomize-options").checked = questionData.ro === true;
      if (questionType === "multiple_response") {
        card.querySelector(".q-require-all-correct").checked = questionData.rac !== false;
      }

      const optionsList = card.querySelector(".options-list");
      optionsList.innerHTML = "";
      const normalizedAnswers = new Set(
        (Array.isArray(questionData.a) ? questionData.a : []).map((answer) =>
          String(answer).toLowerCase()
        )
      );

      const options =
        Array.isArray(questionData.o) && questionData.o.length > 0 ? questionData.o : [""];
      options.forEach((option) => {
        const optionValue = String(option);
        addOption(card, optionValue, normalizedAnswers.has(optionValue.toLowerCase()));
      });

      if (questionType === "multiple_choice") {
        const checkedOptions = Array.from(
          card.querySelectorAll(".options-list .option-correct:checked")
        );
        checkedOptions.forEach((input, idx) => {
          input.checked = idx === 0;
        });

        if (checkedOptions.length === 0) {
          const firstOption = card.querySelector(".options-list .option-correct");
          if (firstOption) {
            firstOption.checked = true;
          }
        }
      }
    }

    syncImageAttributionVisibility(card);
  }

  function syncImageAttributionVisibility(card) {
    const imageValue = card.querySelector(".q-image").value.trim();
    const attributionSection = card.querySelector(".image-attribution-section");
    if (imageValue) {
      attributionSection.classList.remove("hidden");
    } else {
      attributionSection.classList.add("hidden");
    }
  }

  function toggleType(card, type) {
    const answerSection = card.querySelector(".answer-section");
    const answersLabel = card.querySelector(".answers-label");
    const caseSensitiveSection = card.querySelector(".case-sensitive-section");
    const randomizeOptionsSection = card.querySelector(".randomize-options-section");
    const multipleResponseRuleSection = card.querySelector(".mr-all-correct-section");
    const optionsSection = card.querySelector(".options-section");
    const optionsLabel = card.querySelector(".options-label");

    if (type === "text" || type === "numerical") {
      optionsSection.classList.add("hidden");
      randomizeOptionsSection.classList.add("hidden");
      multipleResponseRuleSection.classList.add("hidden");
      answerSection.classList.remove("hidden");
      syncAnswerInputType(card, type);

      if (type === "numerical") {
        caseSensitiveSection.classList.add("hidden");
        answersLabel.textContent = "Accepted Number(s)";
      } else {
        caseSensitiveSection.classList.remove("hidden");
        answersLabel.textContent = "Accepted Answer(s)";
      }
    } else {
      optionsSection.classList.remove("hidden");
      randomizeOptionsSection.classList.remove("hidden");
      answerSection.classList.add("hidden");
      caseSensitiveSection.classList.add("hidden");
      syncOptionControlType(card, type);

      if (type === "multiple_response") {
        multipleResponseRuleSection.classList.remove("hidden");
      } else {
        multipleResponseRuleSection.classList.add("hidden");
      }

      if (type === "multiple_choice") {
        optionsLabel.textContent = "Options (select one correct answer)";
        const checkedOptions = Array.from(
          card.querySelectorAll(".options-list .option-correct:checked")
        );
        checkedOptions.forEach((input, idx) => {
          input.checked = idx === 0;
        });
      } else {
        optionsLabel.textContent = "Options (select correct answers)";
      }
    }
  }

  function syncAnswerInputType(card, type) {
    const answerInputs = card.querySelectorAll(".answers-list .answer-value");
    answerInputs.forEach((input) => {
      if (type === "numerical") {
        input.type = "number";
        input.step = "any";
        input.placeholder = "e.g. 3.14";
      } else {
        input.type = "text";
        input.removeAttribute("step");
        input.placeholder = "Accepted answer";
      }
    });
  }

  function syncOptionControlType(card, type) {
    const optionCorrectInputs = card.querySelectorAll(".options-list .option-correct");
    optionCorrectInputs.forEach((input) => {
      if (type === "multiple_choice") {
        input.type = "radio";
        input.name = `correct-${card.dataset.idx}`;
      } else {
        input.type = "checkbox";
        input.removeAttribute("name");
      }
    });
  }

  function addOption(card, optionText = "", isCorrect = false) {
    const list = card.querySelector(".options-list");
    const row = document.createElement("div");
    row.className = "option-row";
    row.innerHTML = `
      <label class="option-correct-label" title="Mark as correct">
        <input type="checkbox" class="option-correct">
        <span>Correct</span>
      </label>
      <input type="text" class="option-text" placeholder="Option text">
      <button title="Remove">&times;</button>
    `;

    const optionCorrect = row.querySelector(".option-correct");
    optionCorrect.onchange = () => {
      const type = card.querySelector(".q-type").value;
      if (
        type !== "multiple_choice" ||
        !optionCorrect.checked ||
        optionCorrect.type === "radio"
      ) {
        return;
      }

      list.querySelectorAll(".option-correct").forEach((input) => {
        if (input !== optionCorrect) {
          input.checked = false;
        }
      });
    };

    row.querySelector("button").onclick = () => row.remove();
    list.appendChild(row);

    syncOptionControlType(card, card.querySelector(".q-type").value);

    row.querySelector(".option-text").value = String(optionText);
    optionCorrect.checked = Boolean(isCorrect);
  }

  function addAnswer(card, answerValue = "") {
    const list = card.querySelector(".answers-list");
    const row = document.createElement("div");
    row.className = "answer-row";
    row.innerHTML = `
      <input type="text" class="answer-value" placeholder="Accepted answer">
      <button title="Remove">&times;</button>
    `;

    row.querySelector("button").onclick = () => row.remove();
    list.appendChild(row);
    row.querySelector(".answer-value").value = String(answerValue);
    syncAnswerInputType(card, card.querySelector(".q-type").value);
  }

  function renumberQuestions() {
    const cards = document.querySelectorAll(".question-card");
    cards.forEach((card, i) => {
      card.querySelector("h3").textContent = `Question ${i + 1}`;
    });
  }

  function buildQuizData() {
    const quizName = document.getElementById("quiz-name-input").value.trim();
    const quizPassword = document.getElementById("quiz-password-input").value.trim();
    const showAnswer = document.getElementById("show-answer-toggle").checked;
    const showFinalResults = document.getElementById("show-final-results-toggle").checked;
    const cards = document.querySelectorAll(".question-card");
    const questions = [];

    let cardNumber = 0;
    for (const card of cards) {
      cardNumber++;
      const text = card.querySelector(".q-text").value.trim();
      if (!text) continue;

      const image = card.querySelector(".q-image").value.trim();
      const type = card.querySelector(".q-type").value;
      const q = { q: text, t: type, a: [] };

      const note = card.querySelector(".q-note").value.trim();
      if (note) {
        q.nt = note;
      }

      if (image) {
        try {
          q.i = normalizeHttpsImageUrl(image);
        } catch {
          throw new Error("Question " + cardNumber + " image URL must be a valid https URL.");
        }

        const imageAttribution = card.querySelector(".q-image-attribution").value.trim();
        if (imageAttribution) {
          q.ia = imageAttribution;
        }
      }

      if (type === "multiple_response" || type === "multiple_choice") {
        const optionRows = card.querySelectorAll(".options-list .option-row");
        q.o = [];
        q.a = [];
        q.ro = card.querySelector(".q-randomize-options").checked;

        if (type === "multiple_response") {
          q.rac = card.querySelector(".q-require-all-correct").checked;
        }

        optionRows.forEach((row) => {
          const optionText = row.querySelector(".option-text").value.trim();
          if (!optionText) return;

          q.o.push(optionText);
          if (row.querySelector(".option-correct").checked) {
            q.a.push(optionText);
          }
        });
      } else {
        const answerInputs = card.querySelectorAll(".answers-list .answer-value");
        q.a = Array.from(answerInputs)
          .map((input) => input.value.trim())
          .filter(Boolean);

        if (type === "text") {
          q.cs = card.querySelector(".q-case-sensitive").checked;
        }
      }

      questions.push(q);
    }

    const data = { sv: SCHEMA_VERSION, sa: showAnswer, sr: showFinalResults, qs: questions };
    if (quizName) {
      data.n = quizName;
    }

    if (quizPassword) {
      data.p = quizPassword;
    }

    return data;
  }

  function showLinkMessage(message, isError) {
    const linkOutput = document.getElementById("link-output");
    const linkMessage = document.getElementById("link-message");
    const linkInput = document.getElementById("quiz-link");
    const copyBtn = document.getElementById("copy-link-btn");

    linkOutput.classList.remove("hidden");
    linkInput.classList.add("hidden");
    copyBtn.classList.add("hidden");

    linkMessage.textContent = message;
    linkMessage.classList.remove("hidden");
    linkMessage.classList.toggle("error", Boolean(isError));
  }

  function showGeneratedLink(url) {
    const linkOutput = document.getElementById("link-output");
    const linkMessage = document.getElementById("link-message");
    const linkInput = document.getElementById("quiz-link");
    const copyBtn = document.getElementById("copy-link-btn");

    linkOutput.classList.remove("hidden");
    linkInput.value = url;
    linkInput.classList.remove("hidden");
    copyBtn.classList.remove("hidden");

    linkMessage.textContent = "";
    linkMessage.classList.add("hidden");
    linkMessage.classList.remove("error");
  }

  async function generateLink() {
    let data;
    try {
      data = buildQuizData();
    } catch (error) {
      showLinkMessage(error.message || "One or more image URLs are invalid.", true);
      return;
    }

    if (data.qs.length === 0) {
      showLinkMessage("Add at least one question with text.", true);
      return;
    }

    const invalidText = data.qs.some(
      (q) => q.t === "text" && q.a.length === 0
    );
    if (invalidText) {
      showLinkMessage("Each text question needs at least one accepted answer.", true);
      return;
    }

    const invalidMultipleResponse = data.qs.some(
      (q) => q.t === "multiple_response" && (q.o.length < 2 || q.a.length === 0)
    );
    if (invalidMultipleResponse) {
      showLinkMessage(
        "Each multiple-response question needs at least 2 options and 1 correct checkbox selected.",
        true
      );
      return;
    }

    const invalidMultipleChoice = data.qs.some(
      (q) => q.t === "multiple_choice" && (q.o.length < 2 || q.a.length !== 1)
    );
    if (invalidMultipleChoice) {
      showLinkMessage(
        "Each multiple-choice question needs at least 2 options and exactly 1 correct checkbox selected.",
        true
      );
      return;
    }

    const invalidNumerical = data.qs.some(
      (q) =>
        q.t === "numerical" &&
        (q.a.length === 0 || q.a.some((value) => !isNumericValue(value)))
    );
    if (invalidNumerical) {
      showLinkMessage(
        "Each numerical question needs one or more valid numbers (decimals allowed).",
        true
      );
      return;
    }

    try {
      const compressed = await compressQuiz(data);
      const url = window.location.origin + window.location.pathname + "#" + compressed;
      showGeneratedLink(url);
    } catch {
      showLinkMessage(
        "Your browser does not support CompressionStream. Try a recent browser version.",
        true
      );
    }
  }

  function copyLink() {
    const input = document.getElementById("quiz-link");
    navigator.clipboard.writeText(input.value).then(() => {
      const btn = document.getElementById("copy-link-btn");
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Copy"), 2000);
    });
  }

  function shouldShowFinalResults() {
    return quizData.sr !== false;
  }

  // =============================================
  //  QUIZ HOST
  // =============================================
  let quizData = null;
  let currentQuestion = 0;
  let score = 0;
  let answers = [];

  function resetQuizProgress() {
    currentQuestion = 0;
    score = 0;
    answers = [];
  }

  function resetQuizHostView() {
    resetQuizProgress();
    document.getElementById("quiz-start").classList.remove("hidden");
    document.getElementById("quiz-question").classList.add("hidden");
    document.getElementById("quiz-results").classList.add("hidden");
  }

  async function showQuizView(hash) {
    hideEditOverlay();
    document.getElementById("main-view").classList.add("hidden");
    document.getElementById("creator-view").classList.add("hidden");
    document.getElementById("quiz-view").classList.remove("hidden");
    resetQuizHostView();

    try {
      const decompressedQuiz = await decompressQuiz(hash);
      quizData = validateAndNormalizeQuizData(decompressedQuiz);
    } catch {
      document.getElementById("quiz-start").innerHTML =
        "<h1>Invalid Quiz</h1><p>The quiz link appears to be broken or corrupted.</p>" +
        '<a href="#create" class="btn btn-primary">Create a Quiz</a>';
      return;
    }

    const title = typeof quizData.n === "string" ? quizData.n.trim() : "";
    document.getElementById("quiz-title").textContent = title || "Quiz";

    document.getElementById("quiz-info").textContent =
      quizData.qs.length + " question" + (quizData.qs.length !== 1 ? "s" : "");
    document.getElementById("start-quiz-btn").onclick = startQuiz;
    document.getElementById("create-new-link").href = "#create";
  }

  function startQuiz() {
    resetQuizProgress();
    document.getElementById("quiz-start").classList.add("hidden");
    document.getElementById("quiz-results").classList.add("hidden");
    document.getElementById("quiz-question").classList.remove("hidden");
    showQuestion();
  }

  function showQuestion() {
    const q = quizData.qs[currentQuestion];
    document.getElementById("progress-text").textContent =
      "Question " + (currentQuestion + 1) + " of " + quizData.qs.length;
    document.getElementById("question-text").textContent = q.q;

    // Image
    const img = document.getElementById("question-image");
    const attribution = document.getElementById("question-image-attribution");
    if (q.i) {
      img.src = q.i;
      img.classList.remove("hidden");

      if (q.ia) {
        attribution.textContent = "Image by " + q.ia;
        attribution.classList.remove("hidden");
      } else {
        attribution.textContent = "";
        attribution.classList.add("hidden");
      }
    } else {
      img.classList.add("hidden");
      img.src = "";
      attribution.textContent = "";
      attribution.classList.add("hidden");
    }

    // Answer area
    const area = document.getElementById("answer-area");
    area.innerHTML = "";

    if (q.t === "multiple_response" || q.t === "multiple_choice") {
      const optionsToRender = Array.isArray(q.o) ? q.o.slice() : [];
      if (q.ro) {
        shuffleArray(optionsToRender);
      }

      if (q.t === "multiple_response") {
        const requireAllCorrect = q.rac !== false;
        const instruction = document.createElement("p");
        instruction.className = "question-instruction";
        instruction.textContent = requireAllCorrect
          ? "Select all correct options."
          : "Select at least one correct option. Any incorrect selection counts as wrong.";
        area.appendChild(instruction);
      }

      optionsToRender.forEach((opt) => {
        const btn = document.createElement("button");
        btn.className = "mc-option";
        btn.textContent = opt;
        btn.onclick = () => {
          if (q.t === "multiple_choice") {
            area.querySelectorAll(".mc-option").forEach((b) => b.classList.remove("selected"));
            btn.classList.add("selected");
          } else {
            btn.classList.toggle("selected");
          }
        };
        area.appendChild(btn);
      });
    } else if (q.t === "numerical") {
      const input = document.createElement("input");
      input.type = "number";
      input.step = "any";
      input.id = "numerical-answer-input";
      input.placeholder = "Type a number";
      area.appendChild(input);
    } else {
      const input = document.createElement("input");
      input.type = "text";
      input.id = "text-answer-input";
      input.placeholder = "Type your answer";
      area.appendChild(input);
    }

    // Reset buttons / feedback
    document.getElementById("feedback").classList.add("hidden");
    document.getElementById("feedback").className = "hidden";
    document.getElementById("question-note").className = "hidden";
    document.getElementById("question-note").textContent = "";
    document.getElementById("next-question-btn").classList.add("hidden");
    document.getElementById("next-question-btn").textContent = "Next";
    document.getElementById("submit-answer-btn").classList.remove("hidden");
    document.getElementById("submit-answer-btn").onclick = submitAnswer;
  }

  function submitAnswer() {
    const q = quizData.qs[currentQuestion];
    const expectedAnswers = Array.isArray(q.a) ? q.a : [];
    let userAnswer = "";
    let userAnswers = [];

    if (q.t === "multiple_choice") {
      const selected = document.querySelector("#answer-area .mc-option.selected");
      if (!selected) return;
      userAnswer = selected.textContent;
      userAnswers = [userAnswer];
    } else if (q.t === "multiple_response") {
      const selected = Array.from(document.querySelectorAll("#answer-area .mc-option.selected"));
      if (selected.length === 0) return;

      userAnswers = selected.map((item) => item.textContent);
      userAnswer = userAnswers.join(", ");
    } else if (q.t === "numerical") {
      const input = document.getElementById("numerical-answer-input");
      const rawAnswer = input.value.trim();
      if (!isNumericValue(rawAnswer)) return;

      userAnswer = String(Number(rawAnswer));
      userAnswers = [userAnswer];
    } else {
      const input = document.getElementById("text-answer-input");
      userAnswer = input.value.trim();
      if (!userAnswer) return;
      userAnswers = [userAnswer];
    }

    let isCorrect = false;
    if (q.t === "multiple_response") {
      const normalizedSelected = Array.from(new Set(userAnswers.map((a) => a.toLowerCase().trim())));
      const normalizedExpected = Array.from(
        new Set(expectedAnswers.map((a) => String(a).toLowerCase().trim()))
      );
      const expectedSet = new Set(normalizedExpected);
      const hasOnlyCorrectSelections = normalizedSelected.every((a) => expectedSet.has(a));
      const hasAtLeastOneCorrectSelection = normalizedSelected.some((a) => expectedSet.has(a));
      const requireAllCorrect = q.rac !== false;

      if (requireAllCorrect) {
        isCorrect =
          hasOnlyCorrectSelections && normalizedSelected.length === normalizedExpected.length;
      } else {
        isCorrect = hasOnlyCorrectSelections && hasAtLeastOneCorrectSelection;
      }
    } else if (q.t === "numerical") {
      const userNumber = Number(userAnswer);
      const expectedNumbers = expectedAnswers
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value));
      const tolerance = 1e-9;

      isCorrect = expectedNumbers.some((value) => Math.abs(value - userNumber) <= tolerance);
    } else if (q.t === "text") {
      if (q.cs) {
        isCorrect = expectedAnswers.some((a) => String(a).trim() === userAnswer);
      } else {
        const normalizedUser = userAnswer.toLowerCase();
        isCorrect = expectedAnswers.some(
          (a) => String(a).toLowerCase().trim() === normalizedUser
        );
      }
    } else {
      isCorrect = expectedAnswers.some(
        (a) => String(a).toLowerCase() === userAnswer.toLowerCase()
      );
    }

    const expectedDisplay = expectedAnswers.map((value) => String(value));
    const questionNote = typeof q.nt === "string" ? q.nt.trim() : "";
    const hasQuestionNote = Boolean(questionNote);

    if (isCorrect) score++;
    answers.push({ question: q.q, userAnswer, correct: isCorrect, expected: expectedDisplay });

    document.getElementById("submit-answer-btn").classList.add("hidden");

    if (quizData.sa) {
      const fb = document.getElementById("feedback");
      fb.classList.remove("hidden", "correct", "incorrect");
      if (isCorrect) {
        fb.classList.add("correct");
        fb.textContent = "Correct!";
      } else {
        fb.classList.add("incorrect");
        fb.textContent = "Incorrect. Correct answer(s): " + expectedDisplay.join(", ");
      }
    }

    if (hasQuestionNote) {
      const noteBox = document.getElementById("question-note");
      noteBox.textContent = questionNote;
      noteBox.classList.remove("hidden");
    }

    const shouldPauseAfterSubmit = quizData.sa || hasQuestionNote;
    const isLastQuestion = currentQuestion >= quizData.qs.length - 1;
    const nextBtn = document.getElementById("next-question-btn");

    if (!isLastQuestion) {
      if (shouldPauseAfterSubmit) {
        nextBtn.classList.remove("hidden");
        nextBtn.textContent = "Next";
        nextBtn.onclick = () => {
          currentQuestion++;
          showQuestion();
        };
      } else {
        currentQuestion++;
        showQuestion();
      }
    } else {
      if (shouldPauseAfterSubmit) {
        nextBtn.classList.remove("hidden");
        nextBtn.textContent = shouldShowFinalResults() ? "See Results" : "Finish";
        nextBtn.onclick = showResults;
      } else {
        showResults();
      }
    }
  }

  function showResults() {
    document.getElementById("quiz-question").classList.add("hidden");
    document.getElementById("quiz-results").classList.remove("hidden");
    const scoreText = document.getElementById("score-text");
    const breakdown = document.getElementById("results-breakdown");
    const createNewLink = document.getElementById("create-new-link");

    if (shouldShowFinalResults()) {
      scoreText.classList.remove("hidden");
      breakdown.classList.remove("hidden");
      createNewLink.classList.remove("hidden");

      scoreText.textContent =
        "You scored " + score + " out of " + quizData.qs.length;

      breakdown.innerHTML = "";
      answers.forEach((a, i) => {
        const div = document.createElement("div");
        div.className = "result-item " + (a.correct ? "correct" : "incorrect");
        div.innerHTML =
          '<div class="result-question">' + (i + 1) + ". " + escapeHtml(a.question) + "</div>" +
          '<div class="result-answer">Your answer: ' + escapeHtml(a.userAnswer) +
          (a.correct ? " ✓" : " ✗ (Correct: " + escapeHtml(a.expected.join(", ")) + ")") +
          "</div>";
        breakdown.appendChild(div);
      });
    } else {
      scoreText.classList.add("hidden");
      breakdown.classList.add("hidden");
      createNewLink.classList.add("hidden");
      breakdown.innerHTML = "";
    }

    document.getElementById("restart-btn").onclick = startQuiz;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function setCopyrightYear() {
    document.getElementById("copyright-year").textContent = String(new Date().getFullYear());
  }

  // --- Init ---
  initEditOverlay();
  window.addEventListener("hashchange", route);
  setCopyrightYear();
  route();
})();
