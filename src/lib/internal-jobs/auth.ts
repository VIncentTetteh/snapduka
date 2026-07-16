import "server-only";

export function isInternalJobRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  const secrets = [process.env.INTERNAL_JOB_SECRET, process.env.CRON_SECRET].filter((secret): secret is string => Boolean(secret));
  return secrets.length > 0 && secrets.some((secret) => authorization === `Bearer ${secret}`);
}
