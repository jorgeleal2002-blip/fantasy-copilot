import type { App } from '../state/useApp';

/** The league's nickname for a player, in quotes under his name; nothing when
 *  he has none. */
export function Nick({ app, id, className }: { app: App; id: string | null | undefined; className?: string }) {
  const nick = id ? app.nickFor(id) : null;
  return nick ? (
    <div className={'pl-nick-line' + (className ? ' ' + className : '')}>
      <span className="pl-nick">{nick}</span>
    </div>
  ) : null;
}
