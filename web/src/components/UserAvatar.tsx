function avatarColor(name: string): string {
  const colors = ["#3d5a80", "#2a9d8f", "#e76f51", "#6d597a", "#457b9d", "#bc6c25", "#588157"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export function UserAvatar({ name, size = 36 }: { name: string; size?: number }) {
  const letter = (name.trim().charAt(0) || "?").toUpperCase();
  return (
    <span
      className="user-avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: avatarColor(name),
      }}
      aria-hidden
    >
      {letter}
    </span>
  );
}
