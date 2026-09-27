import { getIcon } from "material-file-icons";

export function FileTypeIcon({
  filename,
  className = "file-type-icon",
}: {
  filename: string;
  className?: string;
}) {
  const icon = getIcon(filename);
  return (
    <span
      className={className}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: icon.svg }}
    />
  );
}
