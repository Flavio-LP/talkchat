# Helpers for stubbing the Gemini Generative Language API.
#
# The request body the gem sends is JSON; specs assert on it to lock in the
# v1beta contract (system_instruction, roles, history projection).
module GeminiStubs
  GEMINI_URL_PATTERN = %r{\Ahttps://generativelanguage\.googleapis\.com/}

  # Wraps a tutor payload in the exact envelope TutorService#extract_text digs
  # through: candidates[0].content.parts[0].text
  def gemini_body(text)
    {
      "candidates" => [
        {
          "content" => { "parts" => [ { "text" => text } ], "role" => "model" },
          "finishReason" => "STOP"
        }
      ]
    }.to_json
  end

  # A candidate whose parts array is empty — what Gemini 3.x returns when the
  # thinking budget eats the whole max_output_tokens allowance.
  def gemini_empty_parts_body
    {
      "candidates" => [
        { "content" => { "parts" => [], "role" => "model" }, "finishReason" => "MAX_TOKENS" }
      ]
    }.to_json
  end

  def stub_gemini(text)
    stub_request(:post, GEMINI_URL_PATTERN)
      .to_return(status: 200, body: gemini_body(text), headers: { "Content-Type" => "application/json" })
  end

  def stub_gemini_raw(body)
    stub_request(:post, GEMINI_URL_PATTERN)
      .to_return(status: 200, body: body, headers: { "Content-Type" => "application/json" })
  end

  def stub_gemini_status(status, body = '{"error":{"message":"boom"}}')
    stub_request(:post, GEMINI_URL_PATTERN)
      .to_return(status: status, body: body, headers: { "Content-Type" => "application/json" })
  end

  # The JSON object the tutor is supposed to produce, as a string.
  def tutor_payload(overrides = {})
    {
      "corrected_text" => "I went to school yesterday.",
      "issues" => [
        {
          "original" => "have went",
          "fixed" => "went",
          "type" => "Tempo verbal",
          "explanation" => "Com 'yesterday' usamos o past simple."
        }
      ],
      "reply" => "Nice! What did you do at school yesterday?",
      "reply_translation" => "Legal! O que você fez na escola ontem?",
      "reply_structure" => "Passado simples com 'do' -> 'did', pergunta com inversão sujeito-verbo.",
      "praise" => ""
    }.merge(overrides).to_json
  end

  # Parsed body of the last (or only) request captured by WebMock.
  def last_gemini_request_body
    body = nil
    WebMock::RequestRegistry.instance.requested_signatures.hash.each_key do |signature|
      body = signature.body if signature.uri.to_s.include?("generativelanguage.googleapis.com")
    end
    body && JSON.parse(body)
  end
end

RSpec.configure do |config|
  config.include GeminiStubs
end
