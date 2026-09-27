import alertify from "alertifyjs";
import "alertifyjs/build/css/alertify.css";
import "alertifyjs/build/css/themes/default.css";

alertify.defaults.glossary = {
  ...alertify.defaults.glossary,
  title: "Confirm",
  ok: "Yes",
  cancel: "No",
};

/** Irreversible actions only — Yes/No confirm dialog. */
export function confirmDanger(message: string, onYes: () => void) {
  alertify.confirm(message, onYes);
}

export { alertify };
