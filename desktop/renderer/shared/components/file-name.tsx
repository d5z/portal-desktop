export function FileName({ name }: { name: string }) {
  const extensionStart = name.lastIndexOf('.');
  const hasExtension = extensionStart > 0 && extensionStart < name.length - 1;
  return <strong className="attachment-filename" title={name}>
    <span>{hasExtension ? name.slice(0, extensionStart) : name}</span>
    {hasExtension && <span>{name.slice(extensionStart)}</span>}
  </strong>;
}
