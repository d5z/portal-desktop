import type { ComponentProps } from 'react';

type IconButtonProps = Omit<ComponentProps<'button'>, 'aria-label'> & { label: string };

/** A named icon action; native button props and caller styling pass through. */
export function IconButton({ label, title = label, type = 'button', ...props }: IconButtonProps) {
  return <button {...props} type={type} title={title} aria-label={label} />;
}
