function getToastContainer() {
  let container =
    document.querySelector(".toast-container");

  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    container.setAttribute(
      "aria-live",
      "polite"
    );

    document.body.appendChild(container);
  }

  return container;
}

function getToastIcon(type) {
  const icons = {
    success: "✓",
    error: "!",
    warning: "!",
    info: "i"
  };

  return icons[type] || icons.info;
}

function showToast({
  type = "info",
  title = "",
  message = "",
  duration = 3000
} = {}) {
  const container = getToastContainer();

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", "status");

  toast.innerHTML = `
    <div class="toast-icon">
      ${getToastIcon(type)}
    </div>

    <div class="toast-content">
      ${
        title
          ? `<h3 class="toast-title">${title}</h3>`
          : ""
      }

      <p class="toast-message">
        ${message}
      </p>
    </div>

    <button
      class="toast-close"
      type="button"
      aria-label="Close notification"
    >
      ×
    </button>
  `;

  container.appendChild(toast);

  const closeToast = () => {
    if (toast.classList.contains("toast-leaving")) {
      return;
    }

    toast.classList.add("toast-leaving");

    window.setTimeout(() => {
      toast.remove();
    }, 180);
  };

  const closeButton =
    toast.querySelector(".toast-close");

  closeButton.addEventListener(
    "click",
    closeToast
  );

  if (duration > 0) {
    window.setTimeout(
      closeToast,
      duration
    );
  }

  return toast;
}

window.KairoxUI = {
  success(message, title = "Success") {
    return showToast({
      type: "success",
      title,
      message
    });
  },

  error(message, title = "Something went wrong") {
    return showToast({
      type: "error",
      title,
      message,
      duration: 5000
    });
  },

  warning(message, title = "Attention") {
    return showToast({
      type: "warning",
      title,
      message,
      duration: 4500
    });
  },

  info(message, title = "Information") {
    return showToast({
      type: "info",
      title,
      message
    });
  },

  confirm(options) {
  return showConfirmation(options);
}
  
};
function showConfirmation({
  title = "Confirm Action",
  message = "Are you sure?",
  confirmText = "Confirm",
  cancelText = "Cancel"
} = {}) {
  return new Promise((resolve) => {
    const modal =
      document.getElementById("confirmationModal");

    const titleElement =
      document.getElementById("confirmationTitle");

    const messageElement =
      document.getElementById("confirmationMessage");

    const confirmButton =
      document.getElementById("confirmationConfirmButton");

    const cancelButton =
      document.getElementById("confirmationCancelButton");

    if (
      !modal ||
      !titleElement ||
      !messageElement ||
      !confirmButton ||
      !cancelButton
    ) {
      resolve(false);
      return;
    }

    titleElement.textContent = title;
    messageElement.textContent = message;
    confirmButton.textContent = confirmText;
    cancelButton.textContent = cancelText;

    modal.classList.remove("hidden");

    const cleanup = () => {
      modal.classList.add("hidden");

      confirmButton.removeEventListener(
        "click",
        handleConfirm
      );

      cancelButton.removeEventListener(
        "click",
        handleCancel
      );

      modal.removeEventListener(
        "click",
        handleBackdropClick
      );

      document.removeEventListener(
        "keydown",
        handleKeydown
      );
    };

    const handleConfirm = () => {
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      cleanup();
      resolve(false);
    };

    const handleBackdropClick = (event) => {
      if (event.target === modal) {
        handleCancel();
      }
    };

    const handleKeydown = (event) => {
      if (event.key === "Escape") {
        handleCancel();
      }
    };

    confirmButton.addEventListener(
      "click",
      handleConfirm
    );

    cancelButton.addEventListener(
      "click",
      handleCancel
    );

    modal.addEventListener(
      "click",
      handleBackdropClick
    );

    document.addEventListener(
      "keydown",
      handleKeydown
    );
  });
}