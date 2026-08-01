require "rails_helper"

RSpec.describe "Api::V1::Conversations", type: :request do
  describe "POST /api/v1/conversations" do
    it "creates a conversation and returns its id" do
      expect {
        post "/api/v1/conversations", headers: auth_headers
      }.to change(Conversation, :count).by(1)

      expect(response).to have_http_status(:created)
      expect(response.parsed_body["id"]).to eq(Conversation.last.id)
    end
  end

  describe "DELETE /api/v1/conversations/:id" do
    it "deletes the conversation and its turns" do
      conversation = create(:conversation)
      create(:turn, conversation: conversation)

      delete "/api/v1/conversations/#{conversation.id}", headers: auth_headers

      expect(response).to have_http_status(:no_content)
      expect(Conversation.exists?(conversation.id)).to be(false)
      expect(Turn.count).to eq(0)
    end

    it "returns 404 for an unknown conversation" do
      delete "/api/v1/conversations/999999", headers: auth_headers

      expect(response).to have_http_status(:not_found)
      expect(response.parsed_body["error"]).to be_present
    end
  end
end
