"""
Events Database for STR Demand Analysis

Contains curated events that drive short-term rental demand, including:
- Major sporting events (Super Bowl, World Cup, playoffs)
- Conferences and conventions (CES, SXSW, Comic-Con)
- Festivals (Coachella, Mardi Gras, music festivals)
- Holidays and seasonal events
"""

from datetime import date, datetime
from typing import List, Dict, Any, Optional
from enum import Enum


class EventType(str, Enum):
    SPORTS = "sports"
    CONFERENCE = "conference"
    FESTIVAL = "festival"
    HOLIDAY = "holiday"
    CULTURAL = "cultural"
    POLITICAL = "political"
    OTHER = "other"


class EventRecurrence(str, Enum):
    ONE_TIME = "one_time"
    ANNUAL = "annual"
    VARIES = "varies"  # Location changes yearly (e.g., Super Bowl)


class DemandEvent:
    """Represents an event that affects STR demand."""
    
    def __init__(
        self,
        name: str,
        city: str,
        state: str,
        start_date: date,
        end_date: date,
        event_type: EventType,
        demand_multiplier: float,
        recurrence: EventRecurrence,
        description: str = "",
        affects_radius_miles: int = 25,
        is_custom: bool = False,
        id: Optional[int] = None
    ):
        self.id = id
        self.name = name
        self.city = city
        self.state = state
        self.start_date = start_date
        self.end_date = end_date
        self.event_type = event_type
        self.demand_multiplier = demand_multiplier  # 1.0 = normal, 2.0 = 2x demand
        self.recurrence = recurrence
        self.description = description
        self.affects_radius_miles = affects_radius_miles
        self.is_custom = is_custom
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "city": self.city,
            "state": self.state,
            "start_date": self.start_date.isoformat(),
            "end_date": self.end_date.isoformat(),
            "event_type": self.event_type.value,
            "demand_multiplier": self.demand_multiplier,
            "recurrence": self.recurrence.value,
            "description": self.description,
            "affects_radius_miles": self.affects_radius_miles,
            "is_custom": self.is_custom,
            "days_until": self.days_until,
            "urgency": self.urgency_level
        }
    
    @property
    def days_until(self) -> int:
        """Days until the event starts."""
        today = date.today()
        return (self.start_date - today).days
    
    @property
    def urgency_level(self) -> str:
        """Urgency level based on days until event."""
        days = self.days_until
        if days < 0:
            return "past"
        elif days < 90:
            return "urgent"  # < 3 months
        elif days < 180:
            return "high"    # 3-6 months
        elif days < 365:
            return "medium"  # 6-12 months
        else:
            return "strategic"  # > 1 year


# =============================================================================
# CURATED EVENTS DATABASE
# =============================================================================

CURATED_EVENTS: List[DemandEvent] = [
    # =========================================================================
    # FIFA WORLD CUP 2026 (June 11 - July 19, 2026)
    # =========================================================================
    DemandEvent(
        name="FIFA World Cup 2026 - New York/New Jersey",
        city="New York",
        state="NY",
        start_date=date(2026, 6, 11),
        end_date=date(2026, 7, 19),
        event_type=EventType.SPORTS,
        demand_multiplier=4.0,
        recurrence=EventRecurrence.ONE_TIME,
        description="MetLife Stadium hosts multiple World Cup matches including a semifinal",
        affects_radius_miles=50
    ),
    DemandEvent(
        name="FIFA World Cup 2026 - Los Angeles",
        city="Los Angeles",
        state="CA",
        start_date=date(2026, 6, 11),
        end_date=date(2026, 7, 19),
        event_type=EventType.SPORTS,
        demand_multiplier=4.0,
        recurrence=EventRecurrence.ONE_TIME,
        description="SoFi Stadium hosts World Cup matches including the Final",
        affects_radius_miles=50
    ),
    DemandEvent(
        name="FIFA World Cup 2026 - Dallas",
        city="Dallas",
        state="TX",
        start_date=date(2026, 6, 11),
        end_date=date(2026, 7, 19),
        event_type=EventType.SPORTS,
        demand_multiplier=3.5,
        recurrence=EventRecurrence.ONE_TIME,
        description="AT&T Stadium hosts multiple World Cup matches",
        affects_radius_miles=40
    ),
    DemandEvent(
        name="FIFA World Cup 2026 - Houston",
        city="Houston",
        state="TX",
        start_date=date(2026, 6, 11),
        end_date=date(2026, 7, 19),
        event_type=EventType.SPORTS,
        demand_multiplier=3.5,
        recurrence=EventRecurrence.ONE_TIME,
        description="NRG Stadium hosts World Cup matches",
        affects_radius_miles=40
    ),
    DemandEvent(
        name="FIFA World Cup 2026 - Atlanta",
        city="Atlanta",
        state="GA",
        start_date=date(2026, 6, 11),
        end_date=date(2026, 7, 19),
        event_type=EventType.SPORTS,
        demand_multiplier=3.5,
        recurrence=EventRecurrence.ONE_TIME,
        description="Mercedes-Benz Stadium hosts World Cup matches",
        affects_radius_miles=40
    ),
    DemandEvent(
        name="FIFA World Cup 2026 - Miami",
        city="Miami",
        state="FL",
        start_date=date(2026, 6, 11),
        end_date=date(2026, 7, 19),
        event_type=EventType.SPORTS,
        demand_multiplier=4.0,
        recurrence=EventRecurrence.ONE_TIME,
        description="Hard Rock Stadium hosts World Cup matches including a semifinal",
        affects_radius_miles=40
    ),
    DemandEvent(
        name="FIFA World Cup 2026 - Philadelphia",
        city="Philadelphia",
        state="PA",
        start_date=date(2026, 6, 11),
        end_date=date(2026, 7, 19),
        event_type=EventType.SPORTS,
        demand_multiplier=3.0,
        recurrence=EventRecurrence.ONE_TIME,
        description="Lincoln Financial Field hosts World Cup matches",
        affects_radius_miles=35
    ),
    DemandEvent(
        name="FIFA World Cup 2026 - Seattle",
        city="Seattle",
        state="WA",
        start_date=date(2026, 6, 11),
        end_date=date(2026, 7, 19),
        event_type=EventType.SPORTS,
        demand_multiplier=3.0,
        recurrence=EventRecurrence.ONE_TIME,
        description="Lumen Field hosts World Cup matches",
        affects_radius_miles=35
    ),
    DemandEvent(
        name="FIFA World Cup 2026 - San Francisco",
        city="San Francisco",
        state="CA",
        start_date=date(2026, 6, 11),
        end_date=date(2026, 7, 19),
        event_type=EventType.SPORTS,
        demand_multiplier=3.0,
        recurrence=EventRecurrence.ONE_TIME,
        description="Levi's Stadium hosts World Cup matches",
        affects_radius_miles=40
    ),
    DemandEvent(
        name="FIFA World Cup 2026 - Kansas City",
        city="Kansas City",
        state="MO",
        start_date=date(2026, 6, 11),
        end_date=date(2026, 7, 19),
        event_type=EventType.SPORTS,
        demand_multiplier=3.5,
        recurrence=EventRecurrence.ONE_TIME,
        description="Arrowhead Stadium hosts World Cup matches",
        affects_radius_miles=35
    ),
    DemandEvent(
        name="FIFA World Cup 2026 - Boston",
        city="Boston",
        state="MA",
        start_date=date(2026, 6, 11),
        end_date=date(2026, 7, 19),
        event_type=EventType.SPORTS,
        demand_multiplier=3.0,
        recurrence=EventRecurrence.ONE_TIME,
        description="Gillette Stadium hosts World Cup matches",
        affects_radius_miles=35
    ),
    
    # =========================================================================
    # MAJOR RECURRING SPORTS EVENTS
    # =========================================================================
    DemandEvent(
        name="Super Bowl LX",
        city="Santa Clara",
        state="CA",
        start_date=date(2026, 2, 8),
        end_date=date(2026, 2, 8),
        event_type=EventType.SPORTS,
        demand_multiplier=4.0,
        recurrence=EventRecurrence.VARIES,
        description="NFL Championship Game at Levi's Stadium",
        affects_radius_miles=50
    ),
    DemandEvent(
        name="March Madness - Final Four 2026",
        city="Indianapolis",
        state="IN",
        start_date=date(2026, 4, 4),
        end_date=date(2026, 4, 6),
        event_type=EventType.SPORTS,
        demand_multiplier=3.0,
        recurrence=EventRecurrence.VARIES,
        description="NCAA Basketball Final Four",
        affects_radius_miles=30
    ),
    DemandEvent(
        name="Kentucky Derby 2026",
        city="Louisville",
        state="KY",
        start_date=date(2026, 5, 2),
        end_date=date(2026, 5, 2),
        event_type=EventType.SPORTS,
        demand_multiplier=3.5,
        recurrence=EventRecurrence.ANNUAL,
        description="The most exciting two minutes in sports",
        affects_radius_miles=25
    ),
    DemandEvent(
        name="Indianapolis 500 - 2026",
        city="Indianapolis",
        state="IN",
        start_date=date(2026, 5, 24),
        end_date=date(2026, 5, 24),
        event_type=EventType.SPORTS,
        demand_multiplier=2.5,
        recurrence=EventRecurrence.ANNUAL,
        description="The Greatest Spectacle in Racing",
        affects_radius_miles=30
    ),
    
    # =========================================================================
    # MAJOR CONFERENCES & CONVENTIONS
    # =========================================================================
    DemandEvent(
        name="CES 2026",
        city="Las Vegas",
        state="NV",
        start_date=date(2026, 1, 6),
        end_date=date(2026, 1, 9),
        event_type=EventType.CONFERENCE,
        demand_multiplier=2.5,
        recurrence=EventRecurrence.ANNUAL,
        description="Consumer Electronics Show - 100,000+ attendees",
        affects_radius_miles=20
    ),
    DemandEvent(
        name="SXSW 2026",
        city="Austin",
        state="TX",
        start_date=date(2026, 3, 13),
        end_date=date(2026, 3, 22),
        event_type=EventType.CONFERENCE,
        demand_multiplier=3.0,
        recurrence=EventRecurrence.ANNUAL,
        description="South by Southwest - Music, Film, Interactive",
        affects_radius_miles=25
    ),
    DemandEvent(
        name="Comic-Con 2026",
        city="San Diego",
        state="CA",
        start_date=date(2026, 7, 23),
        end_date=date(2026, 7, 26),
        event_type=EventType.CONFERENCE,
        demand_multiplier=3.5,
        recurrence=EventRecurrence.ANNUAL,
        description="San Diego Comic-Con International - 130,000+ attendees",
        affects_radius_miles=30
    ),
    DemandEvent(
        name="AWS re:Invent 2026",
        city="Las Vegas",
        state="NV",
        start_date=date(2026, 12, 1),
        end_date=date(2026, 12, 5),
        event_type=EventType.CONFERENCE,
        demand_multiplier=2.0,
        recurrence=EventRecurrence.ANNUAL,
        description="Amazon Web Services conference - 50,000+ attendees",
        affects_radius_miles=20
    ),
    DemandEvent(
        name="NAB Show 2026",
        city="Las Vegas",
        state="NV",
        start_date=date(2026, 4, 18),
        end_date=date(2026, 4, 22),
        event_type=EventType.CONFERENCE,
        demand_multiplier=2.0,
        recurrence=EventRecurrence.ANNUAL,
        description="National Association of Broadcasters - Media & Entertainment",
        affects_radius_miles=20
    ),
    DemandEvent(
        name="HIMSS 2026",
        city="Orlando",
        state="FL",
        start_date=date(2026, 3, 9),
        end_date=date(2026, 3, 13),
        event_type=EventType.CONFERENCE,
        demand_multiplier=2.0,
        recurrence=EventRecurrence.VARIES,
        description="Healthcare IT conference - 45,000+ attendees",
        affects_radius_miles=25
    ),
    DemandEvent(
        name="Dreamforce 2026",
        city="San Francisco",
        state="CA",
        start_date=date(2026, 9, 15),
        end_date=date(2026, 9, 18),
        event_type=EventType.CONFERENCE,
        demand_multiplier=2.5,
        recurrence=EventRecurrence.ANNUAL,
        description="Salesforce conference - 170,000+ attendees",
        affects_radius_miles=30
    ),
    
    # =========================================================================
    # MAJOR FESTIVALS
    # =========================================================================
    DemandEvent(
        name="Coachella 2026 - Weekend 1",
        city="Indio",
        state="CA",
        start_date=date(2026, 4, 10),
        end_date=date(2026, 4, 12),
        event_type=EventType.FESTIVAL,
        demand_multiplier=4.0,
        recurrence=EventRecurrence.ANNUAL,
        description="Coachella Valley Music and Arts Festival",
        affects_radius_miles=50
    ),
    DemandEvent(
        name="Coachella 2026 - Weekend 2",
        city="Indio",
        state="CA",
        start_date=date(2026, 4, 17),
        end_date=date(2026, 4, 19),
        event_type=EventType.FESTIVAL,
        demand_multiplier=4.0,
        recurrence=EventRecurrence.ANNUAL,
        description="Coachella Valley Music and Arts Festival",
        affects_radius_miles=50
    ),
    DemandEvent(
        name="Mardi Gras 2026",
        city="New Orleans",
        state="LA",
        start_date=date(2026, 2, 10),
        end_date=date(2026, 2, 17),
        event_type=EventType.FESTIVAL,
        demand_multiplier=4.0,
        recurrence=EventRecurrence.ANNUAL,
        description="New Orleans Mardi Gras celebration",
        affects_radius_miles=30
    ),
    DemandEvent(
        name="Lollapalooza 2026",
        city="Chicago",
        state="IL",
        start_date=date(2026, 7, 30),
        end_date=date(2026, 8, 2),
        event_type=EventType.FESTIVAL,
        demand_multiplier=2.5,
        recurrence=EventRecurrence.ANNUAL,
        description="Major music festival in Grant Park",
        affects_radius_miles=25
    ),
    DemandEvent(
        name="Burning Man 2026",
        city="Reno",
        state="NV",
        start_date=date(2026, 8, 30),
        end_date=date(2026, 9, 7),
        event_type=EventType.FESTIVAL,
        demand_multiplier=3.0,
        recurrence=EventRecurrence.ANNUAL,
        description="Burning Man festival - Reno is primary gateway city",
        affects_radius_miles=60
    ),
    DemandEvent(
        name="Art Basel Miami 2026",
        city="Miami",
        state="FL",
        start_date=date(2026, 12, 3),
        end_date=date(2026, 12, 6),
        event_type=EventType.CULTURAL,
        demand_multiplier=2.5,
        recurrence=EventRecurrence.ANNUAL,
        description="International art fair - attracts global collectors",
        affects_radius_miles=30
    ),
    DemandEvent(
        name="Austin City Limits 2026",
        city="Austin",
        state="TX",
        start_date=date(2026, 10, 2),
        end_date=date(2026, 10, 11),
        event_type=EventType.FESTIVAL,
        demand_multiplier=2.5,
        recurrence=EventRecurrence.ANNUAL,
        description="Two-weekend music festival in Zilker Park",
        affects_radius_miles=25
    ),
    DemandEvent(
        name="SEMA Show 2026",
        city="Las Vegas",
        state="NV",
        start_date=date(2026, 11, 3),
        end_date=date(2026, 11, 6),
        event_type=EventType.CONFERENCE,
        demand_multiplier=2.0,
        recurrence=EventRecurrence.ANNUAL,
        description="Specialty Equipment Market Association - automotive aftermarket",
        affects_radius_miles=20
    ),
    
    # =========================================================================
    # MAJOR HOLIDAYS & SEASONAL EVENTS
    # =========================================================================
    DemandEvent(
        name="New Year's Eve 2025/2026 - NYC",
        city="New York",
        state="NY",
        start_date=date(2025, 12, 30),
        end_date=date(2026, 1, 2),
        event_type=EventType.HOLIDAY,
        demand_multiplier=2.5,
        recurrence=EventRecurrence.ANNUAL,
        description="Times Square New Year's Eve celebration",
        affects_radius_miles=30
    ),
    DemandEvent(
        name="New Year's Eve 2025/2026 - Las Vegas",
        city="Las Vegas",
        state="NV",
        start_date=date(2025, 12, 30),
        end_date=date(2026, 1, 2),
        event_type=EventType.HOLIDAY,
        demand_multiplier=2.5,
        recurrence=EventRecurrence.ANNUAL,
        description="Las Vegas Strip NYE celebrations",
        affects_radius_miles=20
    ),
    DemandEvent(
        name="Spring Break 2026 - Miami",
        city="Miami",
        state="FL",
        start_date=date(2026, 3, 7),
        end_date=date(2026, 3, 29),
        event_type=EventType.HOLIDAY,
        demand_multiplier=2.0,
        recurrence=EventRecurrence.ANNUAL,
        description="College spring break peak season",
        affects_radius_miles=40
    ),
    DemandEvent(
        name="Spring Break 2026 - South Padre Island",
        city="South Padre Island",
        state="TX",
        start_date=date(2026, 3, 7),
        end_date=date(2026, 3, 22),
        event_type=EventType.HOLIDAY,
        demand_multiplier=3.0,
        recurrence=EventRecurrence.ANNUAL,
        description="Major spring break destination",
        affects_radius_miles=30
    ),
    DemandEvent(
        name="July 4th Weekend 2026",
        city="Washington",
        state="DC",
        start_date=date(2026, 7, 3),
        end_date=date(2026, 7, 5),
        event_type=EventType.HOLIDAY,
        demand_multiplier=2.0,
        recurrence=EventRecurrence.ANNUAL,
        description="Independence Day celebrations on the National Mall",
        affects_radius_miles=30
    ),
]


def get_events_for_market(city: str, state: str, custom_events: List[Dict] = None) -> List[DemandEvent]:
    """
    Get all events (curated + custom) that affect a specific market.
    Matches by city name (case-insensitive).
    """
    events = []
    city_lower = city.lower()
    state_lower = state.lower()
    
    # Check curated events
    for event in CURATED_EVENTS:
        if event.city.lower() == city_lower and event.state.lower() == state_lower:
            events.append(event)
    
    # Check custom events
    if custom_events:
        for ce in custom_events:
            if ce.get("city", "").lower() == city_lower and ce.get("state", "").lower() == state_lower:
                events.append(DemandEvent(
                    id=ce.get("id"),
                    name=ce["name"],
                    city=ce["city"],
                    state=ce["state"],
                    start_date=date.fromisoformat(ce["start_date"]) if isinstance(ce["start_date"], str) else ce["start_date"],
                    end_date=date.fromisoformat(ce["end_date"]) if isinstance(ce["end_date"], str) else ce["end_date"],
                    event_type=EventType(ce.get("event_type", "other")),
                    demand_multiplier=ce.get("demand_multiplier", 1.5),
                    recurrence=EventRecurrence(ce.get("recurrence", "one_time")),
                    description=ce.get("description", ""),
                    affects_radius_miles=ce.get("affects_radius_miles", 25),
                    is_custom=True
                ))
    
    # Sort by start date
    events.sort(key=lambda e: e.start_date)
    return events


def get_all_upcoming_events(custom_events: List[Dict] = None, days_ahead: int = 365) -> List[DemandEvent]:
    """
    Get all events happening within the specified number of days.
    """
    today = date.today()
    cutoff = date(today.year + (days_ahead // 365), today.month, today.day)
    
    events = []
    
    # Add curated events that are upcoming
    for event in CURATED_EVENTS:
        if event.start_date >= today and event.start_date <= cutoff:
            events.append(event)
    
    # Add custom events
    if custom_events:
        for ce in custom_events:
            start = date.fromisoformat(ce["start_date"]) if isinstance(ce["start_date"], str) else ce["start_date"]
            end = date.fromisoformat(ce["end_date"]) if isinstance(ce["end_date"], str) else ce["end_date"]
            if start >= today and start <= cutoff:
                events.append(DemandEvent(
                    id=ce.get("id"),
                    name=ce["name"],
                    city=ce["city"],
                    state=ce["state"],
                    start_date=start,
                    end_date=end,
                    event_type=EventType(ce.get("event_type", "other")),
                    demand_multiplier=ce.get("demand_multiplier", 1.5),
                    recurrence=EventRecurrence(ce.get("recurrence", "one_time")),
                    description=ce.get("description", ""),
                    affects_radius_miles=ce.get("affects_radius_miles", 25),
                    is_custom=True
                ))
    
    # Sort by start date
    events.sort(key=lambda e: e.start_date)
    return events


def get_markets_with_events(custom_events: List[Dict] = None) -> Dict[str, List[DemandEvent]]:
    """
    Returns a dictionary mapping "City, ST" to list of events affecting that market.
    """
    markets = {}
    all_events = get_all_upcoming_events(custom_events)
    
    for event in all_events:
        key = f"{event.city}, {event.state}"
        if key not in markets:
            markets[key] = []
        markets[key].append(event)
    
    return markets


def format_events_for_prompt(events: List[DemandEvent]) -> str:
    """
    Format events list for inclusion in AI prompt.
    """
    if not events:
        return "No major upcoming events identified."
    
    lines = []
    for event in events:
        urgency = event.urgency_level.upper()
        lines.append(
            f"- [{urgency}] {event.name} ({event.city}, {event.state}): "
            f"{event.start_date.strftime('%b %d')} - {event.end_date.strftime('%b %d, %Y')} | "
            f"Expected demand: {event.demand_multiplier}x normal | "
            f"{event.description}"
        )
    
    return "\n".join(lines)
