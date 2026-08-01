require "rails_helper"

RSpec.describe TutorService do
  let(:conversation) { create(:conversation) }
  let(:user_text)    { "I have went to school yesterday" }

  subject(:service) { described_class.new(conversation, user_text) }

  describe "#call — happy path" do
    before { stub_gemini(tutor_payload) }

    it "returns the six normalised keys" do
      result = service.call

      expect(result).to match(
        corrected_text: "I went to school yesterday.",
        issues: [
          {
            "original" => "have went",
            "fixed" => "went",
            "type" => "Tempo verbal",
            "explanation" => "Com 'yesterday' usamos o past simple."
          }
        ],
        reply: "Nice! What did you do at school yesterday?",
        reply_translation: "Legal! O que você fez na escola ontem?",
        reply_structure: "Passado simples com 'do' -> 'did', pergunta com inversão sujeito-verbo.",
        praise: ""
      )
    end
  end

  describe "#call — request contract (locks the v1beta regression)" do
    before { stub_gemini(tutor_payload) }

    it "targets the v1beta endpoint" do
      service.call

      expect(a_request(:post, %r{/v1beta/models/})).to have_been_made
    end

    it "does not target v1" do
      service.call

      expect(a_request(:post, %r{/v1/models/})).not_to have_been_made
    end

    it "sends system_instruction with parts as an array" do
      service.call

      body = last_gemini_request_body
      expect(body["system_instruction"]["parts"]).to be_an(Array)
      expect(body["system_instruction"]["parts"].first["text"]).to include("Chalk Talk")
    end

    it "sends the JSON response schema, a thinking budget and a token ceiling" do
      service.call

      config = last_gemini_request_body["generation_config"]
      expect(config["response_mime_type"]).to eq("application/json")
      expect(config["response_schema"]["required"]).to contain_exactly(
        "corrected_text", "issues", "reply", "reply_translation", "reply_structure", "praise"
      )
      expect(config["max_output_tokens"]).to eq(described_class::MAX_OUTPUT_TOKENS)
      expect(config["thinking_config"]).to eq("thinking_level" => "minimal")
    end
  end

  describe "#call — history projection" do
    before { stub_gemini(tutor_payload) }

    it "sends each previous turn as user_text + reply only, never the raw analysis" do
      create(:turn, conversation: conversation, user_text: "I go store", reply: "Which store?")

      service.call

      contents = last_gemini_request_body["contents"]
      expect(contents).to eq(
        [
          { "role" => "user",  "parts" => [ { "text" => "I go store" } ] },
          { "role" => "model", "parts" => [ { "text" => "Which store?" } ] },
          { "role" => "user",  "parts" => [ { "text" => user_text } ] }
        ]
      )
    end

    it "sends the original utterance, not corrected_text" do
      create(:turn, conversation: conversation, user_text: "I go store",
                    corrected_text: "I go to the store.", reply: "Which store?")

      service.call

      texts = last_gemini_request_body["contents"].flat_map { |m| m["parts"].map { |p| p["text"] } }
      expect(texts).to include("I go store")
      expect(texts).not_to include("I go to the store.")
    end

    it "never uses the Anthropic 'assistant' role" do
      create(:turn, conversation: conversation)

      service.call

      roles = last_gemini_request_body["contents"].map { |m| m["role"] }
      expect(roles).to all(be_in(%w[user model]))
    end

    it "keeps at most MAX_HISTORY_TURNS previous turns, newest last" do
      12.times { |i| create(:turn, conversation: conversation, user_text: "line #{i}", reply: "reply #{i}") }

      service.call

      contents = last_gemini_request_body["contents"]
      # 8 pairs + the new utterance
      expect(contents.size).to eq(described_class::MAX_HISTORY_TURNS * 2 + 1)
      expect(contents.first["parts"].first["text"]).to eq("line 4")
      expect(contents.last["parts"].first["text"]).to eq(user_text)
    end

    it "skips the whole pair when an old turn has a blank reply" do
      create(:turn, conversation: conversation, user_text: "orphan line", reply: "")
      create(:turn, conversation: conversation, user_text: "good line", reply: "good reply")

      service.call

      contents = last_gemini_request_body["contents"]
      texts = contents.flat_map { |m| m["parts"].map { |p| p["text"] } }
      expect(texts).not_to include("orphan line")
      expect(texts).to include("good line", "good reply")
      expect(texts).to all(be_present)
    end

    it "sends only the new utterance for a fresh conversation" do
      service.call

      expect(last_gemini_request_body["contents"]).to eq(
        [ { "role" => "user", "parts" => [ { "text" => user_text } ] } ]
      )
    end
  end

  describe "#call — defensive parsing" do
    it "strips ```json fences" do
      stub_gemini("```json\n#{tutor_payload}\n```")

      expect(service.call[:corrected_text]).to eq("I went to school yesterday.")
    end

    it "strips bare ``` fences" do
      stub_gemini("```\n#{tutor_payload}\n```")

      expect(service.call[:reply]).to eq("Nice! What did you do at school yesterday?")
    end

    it "falls back on prose instead of raising" do
      stub_gemini("Sure! Here is what I think about your sentence.")

      result = service.call

      expect(result[:corrected_text]).to eq(user_text)
      expect(result[:issues]).to eq([])
      expect(result[:reply]).to eq(described_class::FALLBACK_REPLY)
      expect(result[:praise]).to eq("")
    end

    it "falls back on malformed JSON instead of raising" do
      stub_gemini('{"corrected_text": "oops"')

      expect { service.call }.not_to raise_error
      expect(service.call[:corrected_text]).to eq(user_text)
    end

    it "falls back when the JSON is valid but is not an object" do
      stub_gemini("[]")

      expect(service.call[:corrected_text]).to eq(user_text)
    end

    # Gemini 3.x thinking-token regression: parts comes back empty, raw is nil,
    # and a naive JSON.parse(nil) would raise TypeError, not JSON::ParserError.
    it "falls back on an empty parts array without raising TypeError" do
      stub_gemini_raw(gemini_empty_parts_body)

      result = nil
      expect { result = service.call }.not_to raise_error
      expect(result[:corrected_text]).to eq(user_text)
      expect(result[:reply]).to eq(described_class::FALLBACK_REPLY)
    end

    it "falls back on empty text — a blank answer is degradation, not failure" do
      stub_gemini("   ")

      result = nil
      expect { result = service.call }.not_to raise_error
      expect(result[:corrected_text]).to eq(user_text)
      expect(result[:reply]).to eq(described_class::FALLBACK_REPLY)
    end

    it "falls back on a body the gem cannot parse at all" do
      stub_gemini_raw("not json at all")

      expect(service.call[:corrected_text]).to eq(user_text)
    end

    it "keeps the user text when corrected_text comes back empty" do
      stub_gemini(tutor_payload("corrected_text" => ""))

      expect(service.call[:corrected_text]).to eq(user_text)
    end

    it "substitutes a generic reply when reply comes back empty" do
      stub_gemini(tutor_payload("reply" => ""))

      expect(service.call[:reply]).to eq(described_class::FALLBACK_REPLY)
    end

    it "substitutes a generic translation when reply_translation comes back empty" do
      stub_gemini(tutor_payload("reply_translation" => ""))

      expect(service.call[:reply_translation]).to eq(described_class::FALLBACK_REPLY_TRANSLATION)
    end

    it "returns an empty structure note when reply_structure comes back empty" do
      stub_gemini(tutor_payload("reply_structure" => ""))

      expect(service.call[:reply_structure]).to eq("")
    end

    it "truncates an oversized praise" do
      stub_gemini(tutor_payload("praise" => "a" * 900))

      expect(service.call[:praise].length).to eq(described_class::PRAISE_MAX_LENGTH)
    end
  end

  describe "#call — normalize_issues" do
    it "returns an empty array when issues is null" do
      stub_gemini(tutor_payload("issues" => nil))

      expect(service.call[:issues]).to eq([])
    end

    it "returns an empty array when issues is not an array" do
      stub_gemini(tutor_payload("issues" => { "original" => "x" }))

      expect(service.call[:issues]).to eq([])
    end

    it "drops non-hash items and fills missing keys with empty strings" do
      stub_gemini(tutor_payload("issues" => [
        "just a string",
        { "original" => "go", "fixed" => "went" },
        { "original" => nil, "fixed" => nil, "type" => "Vazio", "explanation" => "nada" }
      ]))

      expect(service.call[:issues]).to eq(
        [ { "original" => "go", "fixed" => "went", "type" => "", "explanation" => "" } ]
      )
    end

    it "always returns hashes with exactly the four string keys" do
      stub_gemini(tutor_payload("issues" => [ { "original" => "a", "fixed" => "b", "type" => 1, "explanation" => 2 } ]))

      issue = service.call[:issues].first
      expect(issue.keys).to contain_exactly("original", "fixed", "type", "explanation")
      expect(issue.values).to all(be_a(String))
    end
  end

  describe "#call — transport failures" do
    it "flags a 429 as rate limited" do
      stub_gemini_status(429)

      expect { service.call }.to raise_error(described_class::TutorError) { |error|
        expect(error).to be_rate_limited
      }
    end

    it "raises a plain TutorError on 500" do
      stub_gemini_status(500)

      expect { service.call }.to raise_error(described_class::TutorError) { |error|
        expect(error).not_to be_rate_limited
      }
    end

    it "raises TutorError on 400 (bad request)" do
      stub_gemini_status(400)

      expect { service.call }.to raise_error(described_class::TutorError)
    end

    it "raises TutorError on an invalid API key (403)" do
      stub_gemini_status(403)

      expect { service.call }.to raise_error(described_class::TutorError)
    end

    it "raises TutorError on timeout" do
      stub_request(:post, GeminiStubs::GEMINI_URL_PATTERN).to_timeout

      expect { service.call }.to raise_error(described_class::TutorError)
    end

    it "raises TutorError on a connection failure" do
      stub_request(:post, GeminiStubs::GEMINI_URL_PATTERN).to_raise(Faraday::ConnectionFailed.new("no route"))

      expect { service.call }.to raise_error(described_class::TutorError)
    end
  end

  describe "#call — configuration" do
    it "raises ConfigurationError, not TutorError, when the key is missing" do
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with("GEMINI_API_KEY").and_return("")

      expect { service.call }.to raise_error(described_class::ConfigurationError, /GEMINI_API_KEY/)
    end

    it "never calls the API when the key is missing" do
      stub_gemini(tutor_payload)
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with("GEMINI_API_KEY").and_return(nil)

      expect { service.call }.to raise_error(described_class::ConfigurationError)
      expect(a_request(:post, GeminiStubs::GEMINI_URL_PATTERN)).not_to have_been_made
    end
  end

  describe ".model" do
    it "reads GEMINI_MODEL from the environment" do
      allow(ENV).to receive(:fetch).and_call_original
      allow(ENV).to receive(:fetch).with("GEMINI_MODEL", described_class::DEFAULT_MODEL)
                                   .and_return("gemini-9-turbo")

      expect(described_class.model).to eq("gemini-9-turbo")
    end

    it "falls back to the default when the variable is blank" do
      allow(ENV).to receive(:fetch).and_call_original
      allow(ENV).to receive(:fetch).with("GEMINI_MODEL", described_class::DEFAULT_MODEL).and_return("")

      expect(described_class.model).to eq(described_class::DEFAULT_MODEL)
    end
  end
end
