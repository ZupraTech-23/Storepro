document.querySelectorAll(".auto-input").forEach(input => {
  const box = input.parentElement.querySelector(".suggestion-box");
  const type = input.dataset.type;

  let activeIndex = -1;
  let controller = null;

  // ===============================
  // FETCH & SHOW SUGGESTIONS
  // ===============================
  input.addEventListener("input", async () => {
    const q = input.value.trim();

    box.innerHTML = "";
    activeIndex = -1;

    if (!q) {
      box.classList.add("d-none");
      return;
    }

    // Abort previous request
    if (controller) controller.abort();
    controller = new AbortController();

    try {
      const res = await fetch(
        `/search/${type}?q=${encodeURIComponent(q)}`,
        { signal: controller.signal }
      );

      const data = await res.json();

      box.innerHTML = "";

      data.forEach(value => {
        const li = document.createElement("li");
        li.className = "list-group-item list-group-item-action";
        li.textContent = value;

        li.addEventListener("click", () => {
          selectValue(value);
          focusNextField(input);
        });

        box.appendChild(li);
      });

      box.classList.toggle("d-none", data.length === 0);

    } catch (err) {
      if (err.name !== "AbortError") {
        box.classList.add("d-none");
      }
    }
  });

  // ===============================
  // KEYBOARD NAVIGATION + ENTER FLOW
  // ===============================
  input.addEventListener("keydown", e => {
    const items = box.querySelectorAll("li");

    if (e.key === "ArrowDown" && items.length) {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % items.length;
    }

    if (e.key === "ArrowUp" && items.length) {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + items.length) % items.length;
    }

    if (e.key === "Enter") {
      e.preventDefault();

      // CASE 1: suggestion selected
      if (activeIndex >= 0 && items[activeIndex]) {
        selectValue(items[activeIndex].textContent);
        focusNextField(input);
        return;
      }

      // CASE 2: no suggestion selected
      box.classList.add("d-none");
      focusNextField(input);
    }

    if (e.key === "Escape") {
      box.classList.add("d-none");
      activeIndex = -1;
    }

    items.forEach((li, i) =>
      li.classList.toggle("active", i === activeIndex)
    );
  });

  function selectValue(value) {
    input.value = value;
    box.classList.add("d-none");
    activeIndex = -1;
  }
});

// ===================================
// MOVE FOCUS TO NEXT FIELD
// ===================================
function focusNextField(currentInput) {
  const inputs = Array.from(
    document.querySelectorAll(
      'input:not([disabled]):not([type="hidden"]), textarea, select'
    )
  );

  const index = inputs.indexOf(currentInput);
  if (index > -1 && inputs[index + 1]) {
    inputs[index + 1].focus();
  }
}

// ===================================
// CATEGORY → CONDITION AUTO LOGIC
// ===================================
const categoryInput = document.querySelector('[name="category"]');
const conditionInput = document.querySelector('[name="item_condition"]');

function toggleConditionField() {
  if (!categoryInput || !conditionInput) return;

  if (categoryInput.value.toLowerCase() === "accessories") {
    conditionInput.value = "New";
    conditionInput.setAttribute("disabled", true);
  } else {
    conditionInput.removeAttribute("disabled");
  }
}

if (categoryInput) {
  categoryInput.addEventListener("input", toggleConditionField);
  document.addEventListener("DOMContentLoaded", toggleConditionField);
}

// ===================================
// PREVENT ENTER FROM SUBMITTING FORM
// MOVE TO NEXT FIELD INSTEAD
// ===================================
const form = document.querySelector("form");

if (form) {
  form.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      const target = e.target;

      // Allow textarea to accept Enter
      if (target.tagName === "TEXTAREA") return;

      e.preventDefault();
      focusNextField(target);
    }
  });
}
// form control
document.querySelectorAll('.no-arrow').forEach(input => {
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
    }
  });
});