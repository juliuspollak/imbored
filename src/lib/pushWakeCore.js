export async function requestPushWake(client) {
  if (!client?.functions?.invoke) return false;
  try {
    const { error } = await client.functions.invoke("send-push-notifications", {
      body: { mode:"wake" },
    });
    if (error) console.warn("Immediate push wake-up failed; scheduled delivery will retry.");
    return !error;
  } catch {
    console.warn("Immediate push wake-up failed; scheduled delivery will retry.");
    return false;
  }
}
