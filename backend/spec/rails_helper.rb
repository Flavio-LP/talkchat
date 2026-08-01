# This file is copied to spec/ when you run 'rails generate rspec:install'
require 'spec_helper'
ENV['RAILS_ENV'] ||= 'test'

# Must be set BEFORE the environment boots: TutorService raises
# ConfigurationError without it, which would break the whole suite for the
# wrong reason. Never a real key — WebMock blocks outbound calls anyway.
# `||=` alone is not enough: an env_file (e.g. docker-compose) that sets
# GEMINI_API_KEY="" leaves ENV holding a truthy empty string, which ||= would
# not replace.
ENV['GEMINI_API_KEY'] = 'test-key' if ENV['GEMINI_API_KEY'].to_s.strip.empty?
ENV['GEMINI_MODEL']   = 'gemini-3.6-flash' if ENV['GEMINI_MODEL'].to_s.strip.empty?
ENV['APP_ACCESS_TOKEN'] = 'test-token' if ENV['APP_ACCESS_TOKEN'].to_s.strip.empty?

require_relative '../config/environment'
# Prevent database truncation if the environment is production
abort("The Rails environment is running in production mode!") if Rails.env.production?
require 'rspec/rails'
# Add additional requires below this line. Rails is not loaded until this point!

require 'webmock/rspec'
# No spec ever reaches the real Gemini API (quota is free-tier and finite).
WebMock.disable_net_connect!(allow_localhost: true)

# Requires supporting ruby files with custom matchers and macros, etc, in
# spec/support/ and its subdirectories.
Rails.root.glob('spec/support/**/*.rb').sort_by(&:to_s).each { |f| require f }

# Checks for pending migrations and applies them before tests are run.
# If you are not using ActiveRecord, you can remove these lines.
begin
  ActiveRecord::Migration.maintain_test_schema!
rescue ActiveRecord::PendingMigrationError => e
  abort e.to_s.strip
end
RSpec.configure do |config|
  # Remove this line if you're not using ActiveRecord or ActiveRecord fixtures
  config.fixture_paths = [
    Rails.root.join('spec/fixtures')
  ]

  # If you're not using ActiveRecord, or you'd prefer not to run each of your
  # examples within a transaction, remove the following line or assign false
  # instead of true.
  config.use_transactional_fixtures = true

  config.include FactoryBot::Syntax::Methods

  # Cache store is :memory_store in test; clear it so a cached turn list from
  # one example never leaks into the next.
  config.before { Rails.cache.clear }

  # Filter lines from Rails gems in backtraces.
  config.filter_rails_from_backtrace!
  # arbitrary gems may also be filtered via:
  # config.filter_gems_from_backtrace("gem name")
end
