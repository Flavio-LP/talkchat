module RequestAuthHelper
  def auth_headers
    { "Authorization" => "Bearer #{ENV.fetch('APP_ACCESS_TOKEN')}" }
  end
end

RSpec.configure do |config|
  config.include RequestAuthHelper, type: :request
end
