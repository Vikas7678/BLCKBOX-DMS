declare module "alertifyjs" {
  interface AlertifyDefaults {
    glossary: {
      title: string;
      ok: string;
      cancel: string;
    };
    notifier: {
      position: string;
      delay: number;
      closeButton?: boolean;
    };
  }

  interface AlertifyStatic {
    defaults: AlertifyDefaults;
    confirm(
      message: string,
      onok?: () => void,
      oncancel?: () => void,
    ): void;
    confirm(
      title: string,
      message: string,
      onok?: () => void,
      oncancel?: () => void,
    ): void;
  }

  const alertify: AlertifyStatic;
  export default alertify;
}
