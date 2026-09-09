import { createPopupController } from "./handoff.mjs";

const controller = createPopupController(chrome.tabs);
const status = document.getElementById("status");
const page = document.getElementById("page");
const domain = document.getElementById("domain");
const title = document.getElementById("title");
const actions = document.getElementById("actions");
const buttons = [...document.querySelectorAll("button[data-destination]")];

function setBusy(busy) {
  actions.setAttribute("aria-busy", String(busy));
  for (const button of buttons) button.disabled = busy;
}

for (const button of buttons) {
  button.addEventListener("click", async () => {
    setBusy(true);
    status.textContent = "Opening Capsule…";
    try {
      if (await controller.open(button.dataset.destination)) window.close();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Couldn't open Capsule. Try again.";
      setBusy(false);
      button.focus();
    }
  });
}

try {
  const current = await controller.load();
  domain.textContent = current.hostname;
  title.textContent = current.title;
  title.title = current.title;
  page.hidden = false;
  status.textContent = "";
  setBusy(false);
} catch (error) {
  status.textContent = error instanceof Error ? error.message : "Unable to read this page.";
}
