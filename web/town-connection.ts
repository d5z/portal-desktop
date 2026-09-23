import { TOWN_ORIGIN } from "../desktop/shared/town-client";
import { townPairPrompt } from "../desktop/shared/town-pairing";
import { loadDeployment, type WebDeployment } from "./deployment";

export interface TownConnection {
  townOrigin: string;
  apiBase: string;
}
export function defaultTownConnection(
  config: WebDeployment,
  origin: string,
): TownConnection {
  return {
    townOrigin: config.townOrigin || TOWN_ORIGIN,
    apiBase: config.apiBase || (config.mode === "server" ? origin : ""),
  };
}
export async function loadTownConnection(): Promise<TownConnection> {
  return defaultTownConnection(await loadDeployment(), location.origin);
}
export function townRequestURL(
  connection: TownConnection,
  path: string,
): string {
  return (
    (connection.apiBase
      ? connection.apiBase + "/town-api"
      : connection.townOrigin) + path
  );
}
export function townCredentialKey(connection: TownConnection): string {
  return "town-web:town:" + JSON.stringify(connection);
}
export function pairingPrompt(connection: TownConnection): string {
  return townPairPrompt.replace(TOWN_ORIGIN, connection.townOrigin);
}
