function sandboxPushTestEnabled(env = {}) {
  return env.VITE_ENABLE_SANDBOX_PUSH_TEST === "true"
    && env.VITE_APNS_ENVIRONMENT === "sandbox";
}

export { sandboxPushTestEnabled };
