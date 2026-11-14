(() => {
  "use strict";

  const title = document.getElementById("invite-title");
  const note = document.getElementById("invite-note");
  const actions = document.getElementById("invite-actions");
  const open = document.getElementById("open-inlay");
  const copy = document.getElementById("copy-invite");
  const help = document.getElementById("invite-help");
  const status = document.getElementById("invite-status");
  let fallbackTimer;

  function updateInvitation() {
    clearTimeout(fallbackTimer);
    status.textContent = "";
    // No requests, analytics, or storage: the code stays on this device.
    const code = window.location.hash.slice(1);
    const supported = code.length <= 270000 && /^INLAY[123]-[A-Za-z0-9_-]+$/.test(code);
    actions.hidden = !supported;
    help.hidden = !supported;
    if (!supported) {
      title.textContent = "This invitation is incomplete.";
      note.textContent = "Ask your friend to send the full invitation link again.";
      open.removeAttribute("href");
      return;
    }
    title.replaceChildren(document.createTextNode("Compare"), document.createElement("br"), document.createTextNode("travel maps."));
    note.textContent = "Open this invitation in Inlay to see where you've both been.";
    open.href = "inlay://friend?d=" + encodeURIComponent(code);
  }

  open.addEventListener("click", () => {
    // A user-initiated link works with browsers' external-app launch safeguards.
    // Staying on this page is not proof that Inlay is absent or the invite expired.
    clearTimeout(fallbackTimer);
    fallbackTimer = window.setTimeout(() => {
      if (!document.hidden) status.textContent = "Still here? Try Open in Inlay again, or use Copy invitation.";
    }, 1600);
  });

  copy.addEventListener("click", async () => {
    const invitation = window.location.href;
    let timeout;
    copy.disabled = true;
    copy.setAttribute("aria-busy", "true");
    status.textContent = "Copying invitation…";
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await Promise.race([
        navigator.clipboard.writeText(invitation),
        new Promise((resolve, reject) => { timeout = window.setTimeout(() => reject(new Error("clipboard timed out")), 2500); }),
      ]);
      if (window.location.href === invitation) status.textContent = "Invitation copied. You can paste it in Inlay's Friends screen.";
    } catch {
      if (window.location.href === invitation) status.textContent = "Copy the full link from your message, then paste it in Inlay's Friends screen.";
    } finally {
      clearTimeout(timeout);
      copy.disabled = false;
      copy.removeAttribute("aria-busy");
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimeout(fallbackTimer);
  });
  window.addEventListener("hashchange", updateInvitation);
  updateInvitation();
})();
