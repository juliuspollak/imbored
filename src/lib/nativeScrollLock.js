function shouldLockNativeDocumentScroll({ native, active, scoreChallenge, gameIds }) {
  return Boolean(native && (scoreChallenge || gameIds.includes(active)));
}

export { shouldLockNativeDocumentScroll };
