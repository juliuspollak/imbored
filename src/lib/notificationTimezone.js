function hasReminderTimezoneChanged(storedTimezone, currentTimezone) {
  return !storedTimezone || storedTimezone !== currentTimezone;
}

export { hasReminderTimezoneChanged };
