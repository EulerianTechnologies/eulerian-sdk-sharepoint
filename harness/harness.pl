#!/usr/bin/env perl
# Local test harness: a fake "SharePoint" page origin and a fake Eulerian
# collectorjson origin, on two ports so cross-origin (CORS) behaviour is real.
#
#   page origin      http://127.0.0.1:$HARNESS_PAGE_PORT       (default 8401)
#     - serves harness/public/index.html for any page URL, with a strict CSP
#       (script-src 'self': no inline script, no eval)
#     - serves the compiled tracking bundle under /build/
#     - serves fake documents under /files/ and an Office-for-the-web stub
#   collector origin http://127.0.0.1:$HARNESS_COLLECTOR_PORT  (default 8402)
#     - OPTIONS /collectorjson/:site/:epoch   CORS preflight
#     - POST    /collectorjson/:site/:epoch   validates + stores hits (+ site name)
#     - GET     /hits                      { hits, rejected, preflights, cors }
#     - POST    /hits/reset
#     - POST    /control                   { "cors": 0|1 }  toggle CORS headers
#
# Real collector mode (manual test against the real Eulerian collector):
#   HARNESS_REAL_COLLECTOR=collector.customer-host.tld HARNESS_SITE_NAME=<site> perl harness/harness.pl
# makes the page POST to https://<that host>/collectorjson/<site>/... instead of
# the fake collector.
#
# Usage: perl harness/harness.pl   (or: npm run harness)
use Mojolicious::Lite -signatures;
use Mojo::File qw(curfile);
use Mojo::JSON qw(decode_json encode_json true false);
use Mojo::Util qw(b64_decode);

my $root           = curfile->dirname;
my $public         = $root->child('public');
my $build          = $public->child('build');
my $page_port      = $ENV{HARNESS_PAGE_PORT}      || 8401;
my $collector_port = $ENV{HARNESS_COLLECTOR_PORT} || 8402;
my $real_collector = $ENV{HARNESS_REAL_COLLECTOR} || '';
my $collector_origin = "http://127.0.0.1:$collector_port";

# In-memory state of the fake collector.
my %state = (hits => [], rejected => [], preflights => 0, cors => 1);

# Default ComponentProperties used by the harness page. Placeholder host only:
# never put a real customer collector in this repo.
my %default_config = (
  collectorHost  => $real_collector || 'collector.example.com',
  siteName       => $ENV{HARNESS_SITE_NAME} || 'my-site',
  consentMode    => 'pmcat',
  pmcat          => '-',
  setUid         => false,
  setEmailHash   => false,
  trackDownloads => true,
  trackSearch    => true,
  pathPrefix     => 'sharepoint',
  debug          => true,
);

# Strict CSP, close to what SharePoint Online enforces: scripts from 'self'
# only, and fetch() only to self + the collector.
my $connect = "'self' $collector_origin" . ($real_collector ? " https://$real_collector" : '');
my $csp = join '; ',
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src $connect",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'";

# Both origins share one Mojolicious app; each route declares its port.
app->routes->add_condition(port => sub ($route, $c, $captures, $port) { $c->tx->local_port == $port });

app->hook(after_dispatch => sub ($c) {
  return unless $c->tx->local_port == $page_port;
  $c->res->headers->header('Content-Security-Policy' => $csp);
  $c->res->headers->header('Cache-Control' => 'no-store');
});

# ---------------------------------------------------------------- collector

sub cors_headers ($c) {
  return unless $state{cors};
  my $h = $c->res->headers;
  $h->header('Access-Control-Allow-Origin'  => $c->req->headers->origin // '*');
  $h->header('Access-Control-Allow-Methods' => 'POST, OPTIONS');
  $h->header('Access-Control-Allow-Headers' => 'Content-Type');
  $h->header('Vary' => 'Origin');
}

# Returns an error string, or undef when the hit is valid.
sub validate_hit ($hit) {
  return 'hit is not an object' unless ref $hit eq 'HASH';
  return 'missing euidl' unless defined $hit->{euidl} && !ref $hit->{euidl} && length $hit->{euidl};
  return 'missing or invalid url' unless defined $hit->{url} && $hit->{url} =~ m{^https?://};
  return 'missing or invalid ereplay-time' unless defined $hit->{'ereplay-time'} && $hit->{'ereplay-time'} =~ /^\d+$/;
  return 'ereplay-platform must be "sharepoint"' unless ($hit->{'ereplay-platform'} // '') eq 'sharepoint';
  return 'missing ea-sharepoint-sdk version' unless ($hit->{'ea-sharepoint-sdk'} // '') =~ /^\d+\.\d+\.\d+$/;
  my $consent = grep { exists $hit->{$_} } qw(pmcat enoepm);
  return 'exactly one of pmcat / enoepm is required' unless $consent == 1;
  return undef;
}

options '/collectorjson/:site/:epoch' => (port => $collector_port) => sub ($c) {
  $state{preflights}++;
  cors_headers($c);
  $c->rendered(204);
};

post '/collectorjson/:site/:epoch' => (port => $collector_port) => sub ($c) {
  cors_headers($c);
  my $meta = {
    site         => $c->param('site'),
    epoch        => $c->param('epoch'),
    content_type => $c->req->headers->content_type // '',
    origin       => $c->req->headers->origin // '',
  };
  my $error;
  my $body = eval { decode_json($c->req->body) };
  if    ($meta->{site} eq '-')                            { $error = 'site name missing ("-" placeholder)' }
  elsif ($meta->{epoch} !~ /^\d+$/)                       { $error = 'epoch is not numeric' }
  elsif ($meta->{content_type} !~ m{^application/json}i) { $error = 'Content-Type is not application/json' }
  elsif (ref $body ne 'ARRAY' || !@$body)                 { $error = 'body is not a non-empty JSON array' }
  else {
    for my $hit (@$body) {
      last if $error = validate_hit($hit);
    }
  }
  if ($error) {
    push @{$state{rejected}}, {%$meta, error => $error, body => $c->req->body};
    app->log->warn("rejected hit: $error");
    return $c->render(status => 400, json => {error => $error});
  }
  push @{$state{hits}}, map { {%$meta, hit => $_} } @$body;
  app->log->info('hit: ' . encode_json($_)) for @$body;
  $c->render(json => {status => 'ok'});
};

get '/hits' => (port => $collector_port) => sub ($c) {
  $c->render(json => {%state, cors => $state{cors} ? true : false});
};

post '/hits/reset' => (port => $collector_port) => sub ($c) {
  @state{qw(hits rejected preflights)} = ([], [], 0);
  $c->render(json => {status => 'ok'});
};

post '/control' => (port => $collector_port) => sub ($c) {
  my $body = $c->req->json // {};
  $state{cors} = $body->{cors} ? 1 : 0 if exists $body->{cors};
  $c->render(json => {cors => $state{cors} ? true : false});
};

# ---------------------------------------------------------------- page origin

# Compiled tracking bundle. tsc emits ES modules with extension-less imports
# ("./config"), so resolve "/build/x/config" to "x/config.js".
get '/build/*asset' => (port => $page_port) => sub ($c) {
  my $rel = $c->param('asset');
  return $c->reply->not_found if $rel =~ /\.\./;
  $rel .= '.js' unless $rel =~ /\.(js|map)$/;
  my $file = $build->child(split m{/}, $rel);
  return $c->reply->not_found unless -f $file;
  $c->res->headers->content_type('text/javascript; charset=utf-8');
  $c->reply->file($file);
};

get '/app.js' => (port => $page_port) => sub ($c) {
  $c->res->headers->content_type('text/javascript; charset=utf-8');
  $c->reply->file($public->child('app.js'));
};

get '/style.css' => (port => $page_port) => sub ($c) {
  $c->res->headers->content_type('text/css; charset=utf-8');
  $c->reply->file($public->child('style.css'));
};

# Fake documents: tiny bodies with the right Content-Type.
my %types = (
  pdf  => 'application/pdf',
  docx => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
);
get '/files/*name' => (port => $page_port) => sub ($c) {
  my ($ext) = $c->param('name') =~ /\.(\w+)$/;
  my $type = $types{lc($ext // '')} or return $c->reply->not_found;
  $c->res->headers->content_type($type);
  $c->render(data => $ext eq 'pdf' ? "%PDF-1.4\n%harness\n" : "harness fake $ext\n");
};

# Office for the web stub (Doc.aspx?file=...).
get '/_layouts/15/Doc.aspx' => (port => $page_port) => sub ($c) {
  $c->render(data => '<!doctype html><title>Office stub</title><p>Office for the web stub</p>', format => 'html');
};

get '/' => (port => $page_port) => sub ($c) { $c->redirect_to('/sites/hr/SitePages/Home.aspx') };

# Every other page URL renders the fake SharePoint page.
# ?config=<base64 JSON> overrides ComponentProperties (used by the e2e tests).
any '/*page' => (port => $page_port) => sub ($c) {
  my %config = %default_config;
  if (my $raw = $c->param('config')) {
    my $override = eval { decode_json(b64_decode($raw)) };
    %config = (%config, %$override) if ref $override eq 'HASH';
  }
  $c->stash(
    config_json    => encode_json(\%config),
    collector_base => $real_collector ? '' : $collector_origin,
    user_id        => $c->param('userId') // 'A1B2C3D4-E5F6-4711-8899-AABBCCDDEEFF',
    user_email     => $c->param('userEmail') // ' Test@Example.com ',
  );
  $c->render(template => 'page', format => 'html');
};

app->log->level($ENV{HARNESS_LOG_LEVEL} || 'info');
app->log->info("page origin:      http://127.0.0.1:$page_port/");
app->log->info("collector origin: $collector_origin" . ($real_collector ? " (page posts to https://$real_collector)" : ''));

app->start('daemon', '-l', "http://127.0.0.1:$page_port", '-l', "http://127.0.0.1:$collector_port");

__DATA__

@@ page.html.ep
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Harness — fake SharePoint</title>
  <meta name="eulerian-config" content="<%= $config_json %>">
  <meta name="harness-collector-base" content="<%= $collector_base %>">
  <meta name="harness-user-id" content="<%= $user_id %>">
  <meta name="harness-user-email" content="<%= $user_email %>">
  <link rel="stylesheet" href="/style.css">
  <!-- Order matters: deferred and module scripts run in document order, and
       the tracker reads the site title that app.js renders. -->
  <script src="/app.js" defer></script>
  <script type="module" src="/build/harness/src/harness-entry.js"></script>
</head>
<body>
  <header>
    <strong id="site-title">Site</strong>
    <nav>
      <a data-nav href="/sites/hr/SitePages/Home.aspx">HR home</a>
      <a data-nav href="/sites/hr/SitePages/News.aspx">HR news</a>
      <a data-nav href="/sites/it/SitePages/Home.aspx?tab=1">IT home</a>
      <a data-nav href="/SitePages/Home.aspx">Root home</a>
    </nav>
    <form id="search">
      <input id="q" name="q" placeholder="Search">
      <button type="submit">Search</button>
    </form>
  </header>
  <main>
    <h1 id="page-name"></h1>
    <ul>
      <li><a id="dl-same-tab" href="/files/report.pdf">Report (PDF, same tab)</a></li>
      <li><a id="dl-new-tab" href="/files/budget.xlsx" target="_blank">Budget (XLSX, new tab)</a></li>
      <li><a id="dl-office" href="/_layouts/15/Doc.aspx?sourcedoc=%7B0000%7D&amp;file=Minutes.docx&amp;action=default">Minutes (Office for the web)</a></li>
      <li><a id="not-a-doc" data-nav href="/sites/hr/SitePages/About.aspx">About (page link)</a></li>
    </ul>
  </main>
</body>
</html>
