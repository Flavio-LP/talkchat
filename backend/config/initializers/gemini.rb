# Fail loudly at boot, not mysteriously at request time.
#
# The boot is not aborted on purpose: everything except POST /turns works
# without the key, so a half-configured machine can still run the API and the
# test suite. TutorService raises ConfigurationError (=> HTTP 500 with a clear
# message) if a turn is actually attempted without a key.
if Rails.env.local? && ENV["GEMINI_API_KEY"].to_s.strip.empty?
  Rails.logger.warn(
    "[Chalk Talk] GEMINI_API_KEY is empty. POST /api/v1/conversations/:id/turns " \
    "will return 500 until you fill it in backend/.env " \
    "(free key: https://aistudio.google.com/apikey)."
  )
end
