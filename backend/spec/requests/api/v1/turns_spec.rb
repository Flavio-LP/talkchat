require "rails_helper"

RSpec.describe "Api::V1::Turns", type: :request do
  let(:conversation) { create(:conversation) }

  let(:analysis) do
    {
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
      praise: "Boa construção!"
    }
  end

  def stub_tutor(result: analysis, error: nil)
    tutor = instance_double(TutorService)
    allow(TutorService).to receive(:new).and_return(tutor)

    if error
      allow(tutor).to receive(:call).and_raise(error)
    else
      allow(tutor).to receive(:call).and_return(result)
    end

    tutor
  end

  describe "POST /api/v1/conversations/:conversation_id/turns" do
    it "creates a turn and returns the full analysis" do
      stub_tutor

      expect {
        post "/api/v1/conversations/#{conversation.id}/turns",
          params: { text: "I have went to school yesterday" }, headers: auth_headers
      }.to change(Turn, :count).by(1)

      expect(response).to have_http_status(:created)
      body = response.parsed_body
      expect(body).to include(
        "user_text" => "I have went to school yesterday",
        "corrected_text" => "I went to school yesterday.",
        "reply" => "Nice! What did you do at school yesterday?",
        "praise" => "Boa construção!"
      )
      expect(body["issues"].first).to include("original" => "have went", "type" => "Tempo verbal")
      expect(body["id"]).to be_present
      expect(body["created_at"]).to be_present
    end

    it "trims the incoming text" do
      stub_tutor

      post "/api/v1/conversations/#{conversation.id}/turns",
        params: { text: "  hello there  " }, headers: auth_headers

      expect(Turn.last.user_text).to eq("hello there")
    end

    it "returns 422 for a blank text without touching the AI" do
      expect(TutorService).not_to receive(:new)

      post "/api/v1/conversations/#{conversation.id}/turns",
        params: { text: "   " }, headers: auth_headers

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to be_present
      expect(Turn.count).to eq(0)
    end

    it "returns 422 when text is missing entirely" do
      expect(TutorService).not_to receive(:new)

      post "/api/v1/conversations/#{conversation.id}/turns", headers: auth_headers

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "returns 404 for an unknown conversation" do
      post "/api/v1/conversations/999999/turns", params: { text: "hello" }, headers: auth_headers

      expect(response).to have_http_status(:not_found)
    end

    it "returns 502 when the tutor call fails" do
      stub_tutor(error: TutorService::TutorError.new("upstream https://... exploded"))

      post "/api/v1/conversations/#{conversation.id}/turns",
        params: { text: "hello" }, headers: auth_headers

      expect(response).to have_http_status(:bad_gateway)
      expect(response.parsed_body["error"]).to be_present
      # Provider detail must not leak to the browser.
      expect(response.body).not_to include("https://")
      expect(Turn.count).to eq(0)
    end

    it "returns 429 when the tutor call was rate limited" do
      stub_tutor(error: TutorService::TutorError.new("quota", rate_limited: true))

      post "/api/v1/conversations/#{conversation.id}/turns",
        params: { text: "hello" }, headers: auth_headers

      expect(response).to have_http_status(:too_many_requests)
      expect(response.parsed_body["error"]).to match(/muitas mensagens/i)
    end

    it "returns 500, not 502, when the API key is missing" do
      stub_tutor(error: TutorService::ConfigurationError.new("GEMINI_API_KEY is not set."))

      post "/api/v1/conversations/#{conversation.id}/turns",
        params: { text: "hello" }, headers: auth_headers

      expect(response).to have_http_status(:internal_server_error)
      expect(response.parsed_body["error"]).to match(/chave da IA/i)
    end
  end

  describe "GET /api/v1/conversations/:conversation_id/turns" do
    it "lists turns oldest first" do
      create(:turn, conversation: conversation, user_text: "first", created_at: 2.minutes.ago)
      create(:turn, conversation: conversation, user_text: "second", created_at: 1.minute.ago)

      get "/api/v1/conversations/#{conversation.id}/turns", headers: auth_headers

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body.map { |t| t["user_text"] }).to eq(%w[first second])
    end

    it "returns an empty array for a fresh conversation" do
      get "/api/v1/conversations/#{conversation.id}/turns", headers: auth_headers

      expect(response.parsed_body).to eq([])
    end

    it "returns 404 for an unknown conversation" do
      get "/api/v1/conversations/999999/turns", headers: auth_headers

      expect(response).to have_http_status(:not_found)
    end

    it "serves the second identical request from the cache" do
      create(:turn, conversation: conversation, user_text: "cached line")

      get "/api/v1/conversations/#{conversation.id}/turns", headers: auth_headers
      first_body = response.parsed_body

      # Bypass the model so a cache miss would visibly change the payload.
      allow_any_instance_of(Conversation).to receive(:turns).and_call_original

      expect(Rails.cache).to receive(:fetch).and_call_original
      get "/api/v1/conversations/#{conversation.id}/turns", headers: auth_headers

      expect(response.parsed_body).to eq(first_body)
    end

    it "invalidates the cache when a new turn is created in the same second" do
      stub_tutor

      get "/api/v1/conversations/#{conversation.id}/turns", headers: auth_headers
      expect(response.parsed_body.size).to eq(0)

      post "/api/v1/conversations/#{conversation.id}/turns",
        params: { text: "hello" }, headers: auth_headers
      expect(response).to have_http_status(:created)

      get "/api/v1/conversations/#{conversation.id}/turns", headers: auth_headers
      expect(response.parsed_body.size).to eq(1)
      expect(response.parsed_body.first["user_text"]).to eq("hello")
    end

    it "reflects a second turn created within the same second as the first" do
      stub_tutor

      post "/api/v1/conversations/#{conversation.id}/turns",
        params: { text: "one" }, headers: auth_headers
      get "/api/v1/conversations/#{conversation.id}/turns", headers: auth_headers
      expect(response.parsed_body.size).to eq(1)

      post "/api/v1/conversations/#{conversation.id}/turns",
        params: { text: "two" }, headers: auth_headers
      get "/api/v1/conversations/#{conversation.id}/turns", headers: auth_headers

      expect(response.parsed_body.map { |t| t["user_text"] }).to eq(%w[one two])
    end
  end
end
