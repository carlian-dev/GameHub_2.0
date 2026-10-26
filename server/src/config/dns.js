// DNS resolver override for MongoDB Atlas SRV lookups.
// Purpose in plain words: Atlas connection strings are `mongodb+srv://...`,
// which means the driver must look up SRV records (`_mongodb._tcp.<cluster>`)
// before it can even reach a database host. The mongodb driver resolves those
// through Node's own resolver (c-ares), NOT through the Windows resolver used
// by the browser/other apps. On some machines c-ares ends up pointed at a dead
// local DNS (127.0.0.1, common with VPN/proxy/antivirus shims), so startup dies
// with `querySrv ECONNREFUSED` even though `Resolve-DnsName` works fine.
// MONGODB_DNS_SERVERS (comma separated) lets a machine tell Node which resolver
// to use. Empty/unset = keep the system default (no behavior change).
import dns from "node:dns";

export function configureDns(rawServers = "") {
  const servers = String(rawServers || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!servers.length) return [];
  try {
    dns.setServers(servers);
    return servers;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[gamehub] ignoring MONGODB_DNS_SERVERS: ${err && err.message ? err.message : err}`
    );
    return [];
  }
}
