require "rails_helper"

RSpec.describe "Api::V1 authentication", type: :request do
  it "rejects a request with no Authorization header" do
    post "/api/v1/conversations"

    expect(response).to have_http_status(:unauthorized)
    expect(response.parsed_body["error"]).to be_present
  end

  it "rejects a request with the wrong token" do
    post "/api/v1/conversations", headers: { "Authorization" => "Bearer wrong-token" }

    expect(response).to have_http_status(:unauthorized)
  end

  it "rejects a non-Bearer scheme" do
    post "/api/v1/conversations", headers: { "Authorization" => ENV.fetch("APP_ACCESS_TOKEN") }

    expect(response).to have_http_status(:unauthorized)
  end

  it "allows a request with the correct token" do
    post "/api/v1/conversations", headers: auth_headers

    expect(response).to have_http_status(:created)
  end
end
