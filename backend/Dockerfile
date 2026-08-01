# Chalk Talk backend — development image (used by docker-compose, not for production deploy).
FROM ruby:3.2.8-slim

RUN apt-get update -qq && apt-get install -y --no-install-recommends \
      build-essential \
      libpq-dev \
      libyaml-dev \
      git \
      curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN gem install bundler -v 2.6.6

COPY Gemfile Gemfile.lock ./
RUN bundle install

COPY . .

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bin/rails", "server", "-b", "0.0.0.0"]
