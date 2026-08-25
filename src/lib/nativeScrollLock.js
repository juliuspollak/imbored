function shouldLockNativeDocumentScroll({ native, active, scoreChallenge, gameIds }) {
  return Boolean(native && (scoreChallenge || gameIds.includes(active)));
}

function shouldLockAccountMenuScroll(menuOpen) {
  return Boolean(menuOpen);
}

export { shouldLockNativeDocumentScroll, shouldLockAccountMenuScroll };
