// core/discovery.rs
use regex::Regex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::time::Duration;
use tokio::time::sleep;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredSource {
    pub name: String,
    pub url: String,
    pub r#type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredSourceCategory {
    pub category_name: String,
    pub r#type: String,
    pub candidates: Vec<DiscoveredSource>,
}

pub fn parse_duckduckgo_html(html: &str) -> Result<Vec<(String, String)>, Box<dyn Error>> {
    // DuckDuckGo HTML result anchors look like:
    // <a class="result__a" href="//duckduckgo.com/l/?uddg=URL...">Title</a>
    let re = Regex::new(r#"(?s)<a\s+class="result__a"\s+href="([^"]+)"[^>]*>(.*?)</a>"#)?;

    let mut results = Vec::new();
    let title_re = Regex::new(r"<[^>]*>")?;
    for cap in re.captures_iter(html) {
        let href = &cap[1];
        let raw_title = &cap[2];

        // Strip any nested HTML tags from the title
        let title = title_re.replace_all(raw_title, "").trim().to_string();

        let mut real_url = href.to_string();
        if href.contains("uddg=") {
            let full_url = if href.starts_with("//") {
                format!("https:{}", href)
            } else if href.starts_with("/") {
                format!("https://duckduckgo.com{}", href)
            } else {
                href.to_string()
            };
            if let Ok(parsed) = reqwest::Url::parse(&full_url) {
                for (key, val) in parsed.query_pairs() {
                    if key == "uddg" {
                        real_url = val.into_owned();
                        break;
                    }
                }
            }
        } else if href.starts_with("//") {
            real_url = format!("https:{}", href);
        } else if href.starts_with("/") {
            real_url = format!("https://duckduckgo.com{}", href);
        }

        if !title.is_empty()
            && (real_url.starts_with("http://") || real_url.starts_with("https://"))
        {
            results.push((title, real_url));
        }
    }

    Ok(results)
}

fn is_duckduckgo_challenge_page(html: &str) -> bool {
    html.contains("anomaly-modal")
        || html.contains("Unfortunately, bots use DuckDuckGo too")
        || html.contains("challenge-form")
}

fn slugify_city(city: &str, separator: &str) -> String {
    let mut parts = Vec::new();
    let mut current = String::new();

    for ch in city.chars() {
        if ch.is_ascii_alphanumeric() {
            current.push(ch.to_ascii_lowercase());
        } else if !current.is_empty() {
            parts.push(current);
            current = String::new();
        }
    }

    if !current.is_empty() {
        parts.push(current);
    }

    parts.join(separator)
}

fn normalize_state_for_discovery(state: &str) -> String {
    match state.trim().to_ascii_lowercase().as_str() {
        "alabama" => "AL",
        "alaska" => "AK",
        "arizona" => "AZ",
        "arkansas" => "AR",
        "california" => "CA",
        "colorado" => "CO",
        "connecticut" => "CT",
        "delaware" => "DE",
        "florida" => "FL",
        "georgia" => "GA",
        "hawaii" => "HI",
        "idaho" => "ID",
        "illinois" => "IL",
        "indiana" => "IN",
        "iowa" => "IA",
        "kansas" => "KS",
        "kentucky" => "KY",
        "louisiana" => "LA",
        "maine" => "ME",
        "maryland" => "MD",
        "massachusetts" => "MA",
        "michigan" => "MI",
        "minnesota" => "MN",
        "mississippi" => "MS",
        "missouri" => "MO",
        "montana" => "MT",
        "nebraska" => "NE",
        "nevada" => "NV",
        "new hampshire" => "NH",
        "new jersey" => "NJ",
        "new mexico" => "NM",
        "new york" => "NY",
        "north carolina" => "NC",
        "north dakota" => "ND",
        "ohio" => "OH",
        "oklahoma" => "OK",
        "oregon" => "OR",
        "pennsylvania" => "PA",
        "rhode island" => "RI",
        "south carolina" => "SC",
        "south dakota" => "SD",
        "tennessee" => "TN",
        "texas" => "TX",
        "utah" => "UT",
        "vermont" => "VT",
        "virginia" => "VA",
        "washington" => "WA",
        "west virginia" => "WV",
        "wisconsin" => "WI",
        "wyoming" => "WY",
        value => return value.trim().to_ascii_uppercase(),
    }
    .to_string()
}

fn search_url(query: &str) -> String {
    let mut url =
        reqwest::Url::parse("https://www.google.com/search").expect("static URL is valid");
    url.query_pairs_mut().append_pair("q", query);
    url.to_string()
}

fn fallback_candidates_for_category(
    category_name: &str,
    src_type: &str,
    city: &str,
    state: &str,
) -> Vec<DiscoveredSource> {
    let city_dash = slugify_city(city, "-");
    let city_compact = slugify_city(city, "");
    let state_lower = state.trim().to_ascii_lowercase();
    let city_label = city.trim();
    let state_label = state.trim().to_ascii_uppercase();

    let mut urls: Vec<(String, String)> = match category_name {
        "Municipal Website" => vec![
            (
                format!("{city_label} official website"),
                format!("https://www.{city_compact}{state_lower}.gov/"),
            ),
            (
                format!("{city_label} city website"),
                format!("https://www.{city_dash}-{state_lower}.gov/"),
            ),
            (
                format!("{city_label} official website search"),
                search_url(&format!("{city_label} {state_label} official city website")),
            ),
        ],
        "City Council Agenda" => vec![
            (
                format!("{city_label} council agendas"),
                format!("https://www.{city_compact}{state_lower}.gov/agendas"),
            ),
            (
                format!("{city_label} agenda center"),
                format!("https://www.{city_compact}{state_lower}.gov/agendacenter"),
            ),
            (
                format!("{city_label} city council agenda search"),
                search_url(&format!("{city_label} {state_label} city council agenda")),
            ),
        ],
        "Public & Legal Notices" => vec![
            (
                format!("{city_label} public notices"),
                format!("https://www.{city_compact}{state_lower}.gov/public-notices"),
            ),
            (
                format!("{city_label} legal notices search"),
                search_url(&format!("{city_label} {state_label} public legal notices")),
            ),
        ],
        "School Board Agenda" => vec![
            (
                format!("{city_label} school board agendas"),
                search_url(&format!(
                    "{city_label} {state_label} school district board agenda"
                )),
            ),
            (
                format!("{city_label} board of education meetings"),
                search_url(&format!(
                    "{city_label} {state_label} board of education meetings"
                )),
            ),
        ],
        "Police Department Facebook" => vec![
            (
                format!("{city_label} police department"),
                format!("https://www.facebook.com/search/pages/?q={city_dash}%20police%20department%20{state_lower}"),
            ),
            (
                format!("{city_label} police department search"),
                search_url(&format!(
                    "{city_label} {state_label} police department Facebook"
                )),
            ),
        ],
        "Local Reddit Community" => vec![
            (
                format!("{city_label} Reddit search"),
                format!("https://www.reddit.com/search/?q={city_dash}%20{state_lower}"),
            ),
            (
                format!("r/{city_compact}"),
                format!("https://www.reddit.com/r/{city_compact}/"),
            ),
        ],
        "Local Newspaper Headlines" => vec![
            (
                format!("{city_label} local news search"),
                search_url(&format!("{city_label} {state_label} local newspaper")),
            ),
            (
                format!("{city_label} news"),
                search_url(&format!("{city_label} {state_label} news")),
            ),
        ],
        "Chamber of Commerce" => vec![
            (
                format!("{city_label} chamber of commerce"),
                format!("https://www.{city_compact}chamber.org/"),
            ),
            (
                format!("{city_label} chamber search"),
                search_url(&format!("{city_label} {state_label} chamber of commerce")),
            ),
        ],
        "Library Events" => vec![
            (
                format!("{city_label} library events"),
                format!("https://www.{city_compact}library.org/events"),
            ),
            (
                format!("{city_label} library calendar search"),
                search_url(&format!("{city_label} {state_label} library events calendar")),
            ),
        ],
        _ => vec![(
            format!("{city_label} {category_name} search"),
            search_url(&format!("{city_label} {state_label} {category_name}")),
        )],
    };

    urls.dedup_by(|a, b| a.1 == b.1);
    urls.into_iter()
        .map(|(name, url)| DiscoveredSource {
            name,
            url,
            r#type: src_type.to_string(),
        })
        .collect()
}

fn known_city_candidates(
    category_name: &str,
    src_type: &str,
    city: &str,
    state: &str,
) -> Vec<DiscoveredSource> {
    let city_key = slugify_city(city, " ");
    let state_key = state.trim().to_ascii_lowercase();

    let candidates: Vec<(&str, &str, &str)> = match (city_key.as_str(), state_key.as_str()) {
        ("denver", "co") | ("denver", "colorado") => match category_name {
            "Municipal Website" => vec![(
                "Denver official city website",
                "https://www.denvergov.org/",
                "primary_record",
            )],
            "City Council Agenda" => vec![
                (
                    "Denver City Council",
                    "https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/City-Council",
                    "primary_record",
                ),
                (
                    "Denver City Council agendas",
                    "https://denver.legistar.com/Calendar.aspx",
                    "primary_record",
                ),
            ],
            "Public & Legal Notices" => vec![(
                "Denver public notices",
                "https://www.denvergov.org/Government/Citywide-Programs-and-Initiatives/Public-Notices",
                "primary_record",
            )],
            "School Board Agenda" => vec![(
                "Denver Public Schools Board of Education",
                "https://www.dpsk12.org/page/board-of-education",
                "primary_record",
            )],
            "Police Department Facebook" => vec![(
                "Denver Police Department Facebook",
                "https://www.facebook.com/DenverPolice",
                "official_comm",
            )],
            "Local Reddit Community" => vec![(
                "Denver Reddit community",
                "https://www.reddit.com/r/Denver/",
                "community_signal",
            )],
            "Local Newspaper Headlines" => vec![
                (
                    "Denverite",
                    "https://denverite.com/",
                    "media_lead",
                ),
                (
                    "Colorado Public Radio Denver",
                    "https://www.cpr.org/tags/denver/",
                    "media_lead",
                ),
            ],
            "Chamber of Commerce" => vec![(
                "Denver Metro Chamber of Commerce",
                "https://denverchamber.org/",
                "community_signal",
            )],
            "Library Events" => vec![(
                "Denver Public Library events",
                "https://www.denverlibrary.org/events/upcoming",
                "community_signal",
            )],
            _ => Vec::new(),
        },
        ("brighton", "co") | ("brighton", "colorado") => match category_name {
            "Municipal Website" => vec![(
                "Brighton official city website",
                "https://www.brightonco.gov/",
                "primary_record",
            )],
            "City Council Agenda" => vec![(
                "Brighton Agenda Center",
                "https://www.brightonco.gov/AgendaCenter",
                "primary_record",
            )],
            "Public & Legal Notices" => vec![(
                "Brighton News Flash",
                "https://www.brightonco.gov/CivicAlerts.aspx",
                "official_comm",
            )],
            "School Board Agenda" => vec![(
                "School District 27J",
                "https://www.sd27j.org/",
                "primary_record",
            )],
            _ => Vec::new(),
        },
        ("aurora", "co") | ("aurora", "colorado") => match category_name {
            "Municipal Website" => vec![(
                "Aurora official city website",
                "https://www.auroragov.org/",
                "primary_record",
            )],
            "City Council Agenda" => vec![(
                "Aurora City Council calendar",
                "https://aurora.legistar.com/Calendar.aspx",
                "primary_record",
            )],
            "School Board Agenda" => vec![(
                "Aurora Public Schools",
                "https://www.aurorak12.org/",
                "primary_record",
            )],
            _ => Vec::new(),
        },
        ("boulder", "co") | ("boulder", "colorado") => match category_name {
            "Municipal Website" => vec![(
                "Boulder official city website",
                "https://bouldercolorado.gov/",
                "primary_record",
            )],
            "City Council Agenda" => vec![(
                "Boulder City Council",
                "https://bouldercolorado.gov/services/city-council",
                "primary_record",
            )],
            "Local Newspaper Headlines" => vec![(
                "Daily Camera",
                "https://www.dailycamera.com/",
                "media_lead",
            )],
            _ => Vec::new(),
        },
        ("longmont", "co") | ("longmont", "colorado") => match category_name {
            "Municipal Website" => vec![
                (
                    "Longmont official city website",
                    "https://www.longmontcolorado.gov/",
                    "primary_record",
                ),
                (
                    "Longmont city news",
                    "https://www.longmontcolorado.gov/news",
                    "official_comm",
                ),
            ],
            "City Council Agenda" => vec![
                (
                    "Longmont agendas and minutes",
                    "https://www.longmontcolorado.gov/departments/departments-a-d/city-clerk/agendas-and-minutes",
                    "primary_record",
                ),
                (
                    "Longmont City Council",
                    "https://www.longmontcolorado.gov/departments/departments-a-d/city-council",
                    "primary_record",
                ),
            ],
            "Public & Legal Notices" => vec![
                (
                    "Longmont public notices search",
                    "https://www.longmontcolorado.gov/departments/departments-a-d/city-clerk",
                    "primary_record",
                ),
                (
                    "Colorado public notices",
                    "https://www.publicnoticecolorado.com/",
                    "primary_record",
                ),
                (
                    "Boulder County public notices",
                    "https://bouldercounty.gov/",
                    "primary_record",
                ),
            ],
            "School Board Agenda" => vec![(
                "St. Vrain Valley Schools",
                "https://www.svvsd.org/",
                "primary_record",
            )],
            "Police Department Facebook" => vec![
                (
                    "Longmont Public Safety",
                    "https://www.longmontcolorado.gov/departments/departments-n-z/public-safety",
                    "official_comm",
                ),
                (
                    "City of Longmont Facebook",
                    "https://www.facebook.com/cityoflongmontco/",
                    "community_signal",
                ),
                (
                    "Longmont Public Safety Facebook",
                    "https://www.facebook.com/LongmontFirePoliceOEM/",
                    "community_signal",
                ),
            ],
            "Local Reddit Community" => vec![
                (
                    "r/Longmont",
                    "https://www.reddit.com/r/Longmont/",
                    "community_signal",
                ),
                (
                    "r/Boulder",
                    "https://www.reddit.com/r/boulder/",
                    "community_signal",
                ),
            ],
            "Local Newspaper Headlines" => vec![
                (
                    "Longmont Leader local news",
                    "https://www.longmontleader.com/local-news",
                    "media_lead",
                ),
                (
                    "Times-Call Longmont news",
                    "https://www.timescall.com/location/colorado/boulder-county/longmont/",
                    "media_lead",
                ),
            ],
            "Chamber of Commerce" => vec![(
                "Longmont Area Chamber of Commerce",
                "https://longmontchamber.org/",
                "community_signal",
            )],
            "Library Events" => vec![
                (
                    "Longmont Library",
                    "https://www.longmontcolorado.gov/departments/departments-e-m/library",
                    "community_signal",
                ),
                (
                    "Visit Longmont events",
                    "https://www.visitlongmont.org/events/",
                    "community_calendar",
                ),
                (
                    "Downtown Longmont events",
                    "https://www.downtownlongmont.com/events/calendar",
                    "community_calendar",
                ),
                (
                    "Longmont city events",
                    "https://longmontcolorado.gov/events/",
                    "official_calendar",
                ),
                (
                    "Longmont city YouTube",
                    "https://www.youtube.com/cityoflongmont",
                    "official_comm",
                ),
            ],
            _ => Vec::new(),
        },
        ("fort collins", "co") | ("fort collins", "colorado") => match category_name {
            "Municipal Website" => vec![(
                "Fort Collins official city website",
                "https://www.fcgov.com/",
                "primary_record",
            )],
            "City Council Agenda" => vec![(
                "Fort Collins City Council agendas",
                "https://www.fcgov.com/cityclerk/councilagenda",
                "primary_record",
            )],
            "Local Newspaper Headlines" => vec![(
                "Coloradoan",
                "https://www.coloradoan.com/",
                "media_lead",
            )],
            _ => Vec::new(),
        },
        ("lakewood", "co") | ("lakewood", "colorado") => match category_name {
            "Municipal Website" => vec![(
                "Lakewood official city website",
                "https://www.lakewood.org/",
                "primary_record",
            )],
            "City Council Agenda" => vec![(
                "Lakewood City Council",
                "https://www.lakewood.org/Government/City-Council",
                "primary_record",
            )],
            _ => Vec::new(),
        },
        ("pueblo", "co") | ("pueblo", "colorado") => match category_name {
            "Municipal Website" => vec![(
                "Pueblo official city website",
                "https://www.pueblo.us/",
                "primary_record",
            )],
            "City Council Agenda" => vec![(
                "Pueblo Agenda Center",
                "https://www.pueblo.us/AgendaCenter",
                "primary_record",
            )],
            "Local Newspaper Headlines" => vec![(
                "Pueblo Chieftain",
                "https://www.chieftain.com/",
                "media_lead",
            )],
            _ => Vec::new(),
        },
        ("grand junction", "co") | ("grand junction", "colorado") => match category_name {
            "Municipal Website" => vec![(
                "Grand Junction official city website",
                "https://www.gjcity.org/",
                "primary_record",
            )],
            "City Council Agenda" => vec![(
                "Grand Junction Agenda Center",
                "https://www.gjcity.org/AgendaCenter",
                "primary_record",
            )],
            _ => Vec::new(),
        },
        _ => Vec::new(),
    };

    candidates
        .into_iter()
        .map(|(name, url, known_type)| DiscoveredSource {
            name: name.to_string(),
            url: url.to_string(),
            r#type: if known_type.is_empty() {
                src_type.to_string()
            } else {
                known_type.to_string()
            },
        })
        .collect()
}

#[cfg(test)]
fn fallback_discovery_categories(city: &str, state: &str) -> Vec<DiscoveredSourceCategory> {
    discovery_targets(city, state)
        .into_iter()
        .map(|(cat_name, src_type, _query)| DiscoveredSourceCategory {
            category_name: cat_name.to_string(),
            r#type: src_type.to_string(),
            candidates: merge_candidates(
                known_city_candidates(cat_name, src_type, city, state),
                fallback_candidates_for_category(cat_name, src_type, city, state),
            ),
        })
        .collect()
}

#[cfg(test)]
fn merge_candidates(
    mut primary: Vec<DiscoveredSource>,
    secondary: Vec<DiscoveredSource>,
) -> Vec<DiscoveredSource> {
    for candidate in secondary {
        if !primary.iter().any(|existing| existing.url == candidate.url) {
            primary.push(candidate);
        }
    }
    primary
}

pub async fn search_duckduckgo(
    client: &Client,
    query: &str,
) -> Result<Vec<(String, String)>, Box<dyn Error>> {
    let mut base_url = reqwest::Url::parse("https://html.duckduckgo.com/html/")?;
    base_url.query_pairs_mut().append_pair("q", query);
    let search_url = base_url.to_string();

    let res = client.get(&search_url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .send()
        .await?;

    if !res.status().is_success() {
        return Err(format!("Source search returned an error: {}", res.status()).into());
    }

    let html = res.text().await?;

    if is_duckduckgo_challenge_page(&html) {
        return Err("Search engine asked for human verification".into());
    }

    parse_duckduckgo_html(&html)
}

fn discovery_targets(city: &str, state: &str) -> Vec<(&'static str, &'static str, String)> {
    vec![
        (
            "Municipal Website",
            "primary_record",
            format!("{} {} government website", city, state),
        ),
        (
            "City Council Agenda",
            "primary_record",
            format!("{} {} city council agenda", city, state),
        ),
        (
            "Public & Legal Notices",
            "primary_record",
            format!("{} {} public notices", city, state),
        ),
        (
            "School Board Agenda",
            "primary_record",
            format!("{} {} school district board agenda", city, state),
        ),
        (
            "Police Department Facebook",
            "official_comm",
            format!("{} {} police department Facebook", city, state),
        ),
        (
            "Local Reddit Community",
            "community_signal",
            format!("{} {} Reddit", city, state),
        ),
        (
            "Local Newspaper Headlines",
            "media_lead",
            format!("{} {} local newspaper", city, state),
        ),
        (
            "Chamber of Commerce",
            "community_signal",
            format!("{} {} chamber of commerce", city, state),
        ),
        (
            "Library Events",
            "community_signal",
            format!("{} {} library events", city, state),
        ),
    ]
}

pub async fn discover_all_sources(
    city: &str,
    state: &str,
) -> Result<Vec<DiscoveredSourceCategory>, Box<dyn Error>> {
    let normalized_state = normalize_state_for_discovery(state);
    let state = normalized_state.as_str();
    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()?;

    let mut categories = Vec::new();

    for (cat_name, src_type, query) in discovery_targets(city, state) {
        // Politeness delay of 500ms between requests to prevent rate-limiting
        sleep(Duration::from_millis(500)).await;

        let mut candidates = known_city_candidates(cat_name, src_type, city, state);
        match search_duckduckgo(&client, &query).await {
            Ok(results) => {
                for (title, url) in results.into_iter().take(3) {
                    let candidate = DiscoveredSource {
                        name: title,
                        url,
                        r#type: src_type.to_string(),
                    };
                    if !candidates
                        .iter()
                        .any(|existing| existing.url == candidate.url)
                    {
                        candidates.push(candidate);
                    }
                }
            }
            Err(e) => {
                eprintln!("Discovery search failed for query '{}': {}", query, e);
            }
        }

        if candidates.is_empty() {
            candidates = fallback_candidates_for_category(cat_name, src_type, city, state);
        }

        categories.push(DiscoveredSourceCategory {
            category_name: cat_name.to_string(),
            r#type: src_type.to_string(),
            candidates,
        });
    }

    Ok(categories)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_duckduckgo_challenge_page() {
        let html = r#"
            <form id="challenge-form">
              <div class="anomaly-modal__title">
                Unfortunately, bots use DuckDuckGo too.
              </div>
            </form>
        "#;

        assert!(is_duckduckgo_challenge_page(html));
    }

    #[test]
    fn fallback_discovery_returns_actionable_civic_candidates() {
        let categories = fallback_discovery_categories("Brighton", "CO");

        assert_eq!(categories.len(), 9);
        assert!(categories
            .iter()
            .all(|category| !category.candidates.is_empty()));

        let council = categories
            .iter()
            .find(|category| category.category_name == "City Council Agenda")
            .expect("city council category");
        assert!(council
            .candidates
            .iter()
            .any(|candidate| candidate.url.contains("brightonco.gov/agendas")));

        let newspaper = categories
            .iter()
            .find(|category| category.category_name == "Local Newspaper Headlines")
            .expect("newspaper category");
        assert!(newspaper
            .candidates
            .iter()
            .any(|candidate| candidate.url.starts_with("https://www.google.com/search")));
    }

    #[test]
    fn denver_discovery_includes_known_civic_portals() {
        let categories = fallback_discovery_categories("Denver", "CO");

        let council = categories
            .iter()
            .find(|category| category.category_name == "City Council Agenda")
            .expect("city council category");
        assert!(council
            .candidates
            .iter()
            .any(|candidate| candidate.url == "https://denver.legistar.com/Calendar.aspx"));

        let notices = categories
            .iter()
            .find(|category| category.category_name == "Public & Legal Notices")
            .expect("public notices category");
        assert!(notices
            .candidates
            .iter()
            .any(|candidate| candidate.url.contains(
                "denvergov.org/Government/Citywide-Programs-and-Initiatives/Public-Notices"
            )));
    }

    #[test]
    fn colorado_city_discovery_includes_known_official_seeds() {
        let cities = [
            ("Brighton", "brightonco.gov"),
            ("Aurora", "auroragov.org"),
            ("Boulder", "bouldercolorado.gov"),
            ("Longmont", "longmontcolorado.gov"),
            ("Fort Collins", "fcgov.com"),
            ("Lakewood", "lakewood.org"),
            ("Pueblo", "pueblo.us"),
            ("Grand Junction", "gjcity.org"),
        ];

        for (city, expected_host) in cities {
            let categories = fallback_discovery_categories(city, "CO");
            let official_count = categories
                .iter()
                .flat_map(|category| category.candidates.iter())
                .filter(|candidate| {
                    candidate.r#type == "primary_record" && !candidate.url.contains("google.com")
                })
                .count();
            assert!(
                official_count >= 2,
                "{city} should have at least two deterministic official seeds"
            );
            assert!(
                categories
                    .iter()
                    .flat_map(|category| category.candidates.iter())
                    .any(|candidate| candidate.url.contains(expected_host)),
                "{city} should include {expected_host}"
            );
        }
    }

    #[test]
    fn normalizes_full_state_names_for_discovery_inputs() {
        assert_eq!(normalize_state_for_discovery("Colorado"), "CO");
        assert_eq!(normalize_state_for_discovery(" colorado "), "CO");
        assert_eq!(normalize_state_for_discovery("co"), "CO");
    }

    #[test]
    fn longmont_discovery_includes_local_media_and_dark_signal_seeds() {
        let categories = fallback_discovery_categories("Longmont", "CO");
        let all_candidates: Vec<&DiscoveredSource> = categories
            .iter()
            .flat_map(|category| category.candidates.iter())
            .collect();

        assert!(all_candidates
            .iter()
            .any(|candidate| candidate.url == "https://www.reddit.com/r/Longmont/"));
        assert!(all_candidates
            .iter()
            .any(|candidate| candidate.url == "https://www.youtube.com/cityoflongmont"));
        assert!(all_candidates
            .iter()
            .any(|candidate| candidate.url == "https://www.publicnoticecolorado.com/"));
        assert!(all_candidates
            .iter()
            .any(|candidate| candidate.url == "https://www.longmontleader.com/local-news"));
        assert!(all_candidates
            .iter()
            .any(|candidate| candidate.url.contains("bouldercounty.gov")));
        assert!(all_candidates
            .iter()
            .any(|candidate| candidate.r#type == "community_signal"));
        assert!(
            all_candidates.len() >= 15,
            "Longmont should expose a broad enough candidate set for a real issue"
        );
    }
}
