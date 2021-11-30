import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Component as IcalComp, Event as IcalEvent } from 'ical.js'

export default function useCalendar () {
  const [rawCalendar, setRawCalendar] = useState()
  const [calendar, setCalendar] = useState()
  const [events, setEvents] = useState()

  // When events are passed back, they have the form:
  /*
    (EventType) = {
      uid: STRING,
      day: INTEGER(ms),
      name: STRING,
      description: STRING,
      summary: STRING,
      location: STRING,
      duration: INTEGER(ms),
      times: [FLOAT(hour of day... 8:30am = 8.5 && 8:30pm = 20.5)],
      buildingCode: STRING or null
    }
  */

  const dynamicIterators = useRef({})  // Holds the iterators that will count when events are occuring as well as when they have occured in the past
  // (uid): { days: { (dayTime): [EventType...] }, lastCheckedDay: DATE, iter: ITERATOR }

  const setCalendarFromFile = useCallback(file => {
    const reader = new FileReader()

    reader.onabort = () => console.log('file reading was aborted')
    reader.onerror = () => console.log('file reading has failed')
    reader.onload = () => {
      setRawCalendar(reader.result)
    }

    reader.readAsText(file)
  }, [setRawCalendar])

  useEffect(() => {
    // There are multiple ways a new rawCalendar can be set. We can to create the calendar component no matter what.
    // We also want to save this calendar to local storage.
    if (rawCalendar) {
      const cal = IcalComp.fromString(rawCalendar)
      setCalendar(cal)
      localStorage.setItem('calendar', rawCalendar)
    }
  }, [rawCalendar, setCalendar])

  useEffect(() => {
    // Startup stuff
    // When the page is reloaded, we want to load the saved raw calendar if it exists
    const savedCalendar = localStorage.getItem('calendar')
    if (savedCalendar) {
      setRawCalendar(savedCalendar)
    }
  }, [setRawCalendar])

  const updateEventIter = useCallback((event, toDate) => {
    // We are going to use a bit of dynamic programming here.
    // Re-occuring events are annoying because we have to iterate over a reoccurance object every time we want to get a day.
    // Instead, when we need to get the events for a given day, we iterate over the reoccurance object and save the days of occurances as well as the final state of the object so we can pick up where we left off
    // When we get request for another day, we can either look back and see if there was an occurance on that day or pick up where we left off and iterate until we are past the new day
    // Iterates the reoccuring event until it is finished or until we are past the toDate
    if (!event.isRecurring()) {
      return false
    }
    const uid = event.uid
    if (!dynamicIterators.current[uid]) {
      dynamicIterators.current[uid] = {
        days: {},
        lastCheckedDay: null,
        iter: event.iterator()
      }
    }
    const iterData = dynamicIterators.current[uid]
    if (iterData.lastCheckedDay >= toDate) {
      // Then this event iterator is already up to date
      return true
    }

    function formEventType (time) {
      const date = time.toJSDate()
      // We need to extract the time from the date
      const timeOfDay = date.getHours() + (date.getMinutes() / 60)
      // We need this date to be the day, but set all time values to 0
      date.setHours(0, 0, 0, 0)
      const timeValue = date.getTime()
      return {
        uid: event.uid,
        day: timeValue,
        name: event.summary,
        description: event.description,
        location: event.location,
        duration: event.duration.toSeconds() * 1000,
        times: [timeOfDay],
        buildingCode: event.location ? event.location.split(' ')[0] : null
      }
    }

    while (iterData.lastCheckedDay < toDate) {
      // While the iterator has not run out of events and we are not past the toDate
      const nextTime = iterData.iter.next()
      if (iterData.iter.complete) {
        break
      }
      // Only run if the event is not at an
      iterData.lastCheckedDay = nextTime.toJSDate()
      const formattedEvent = formEventType(nextTime)
      const day = formattedEvent.day
      if (!iterData.days[day]) {
        // Then we will add a new event to this day
        iterData.days[day] = formattedEvent
      } else {
        // Then we just need to add the new time to the existing event
        iterData.days[day].times.push(formattedEvent.times[0])
      }
    }
  }, [])

  const getDayEvents = useCallback(date => {
    // Gets all the events that fall on this day
    // If the event is reocurring, we will update it's iterator to the correct day and then check if the given date is in the event's day array
    // If the event is not reocurring, we will check if the given date is the same as the event's day
    // First we need to convert the date to just the day
    const dayDate = new Date(date.getTime())
    dayDate.setHours(0, 0, 0, 0)
    const day = dayDate.getTime()
    // Then we iterate over all the events and check if they are on this day
    const dayEvents = []
    for (const event of events) {
      if (event.isRecurring()) {
        // Then we treat this as a reoccuring event
        updateEventIter(event, dayDate)
        const dayEvent = dynamicIterators.current[event.uid].days[day]
        if (dayEvent) {
          dayEvents.push(dayEvent)
        }
      } else {
        // Then we treat this as a non-reoccuring event
        const eventStartDate = event.startDate.toJSDate()
        const eventTime = eventStartDate.getHours() + (eventStartDate.getMinutes() / 60)
        eventStartDate.setHours(0, 0, 0, 0)
        const eventDay = eventStartDate.getTime()
        if (eventDay === day) {
          // Then we need to format the event and add it to the events list
          dayEvents.push({
            uid: event.uid,
            day: eventDay,
            name: event.summary,
            description: event.description,
            location: event.location,
            duration: event.duration.toSeconds() * 1000,
            times: [eventTime],
            buildingCode: event.location ? event.location.split(' ')[0] : null
          })
        }
      }
    }
    return dayEvents
  }, [events, updateEventIter])

  const getWeekEvents = useCallback(date => {
    // To do this, first we need to know what the date of each day (monday-friday) is
    const weekStart = new Date(date.getTime())
    weekStart.setHours(0, 0, 0, 0)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())
    // Weekstart is now the monday of the current week
    // Now we need to iterate 5 times and get the day's events for each
    const weekEvents = {}
    for (let i = 0; i < 5; i++) {
      weekStart.setDate(weekStart.getDate() + 1)
      const dayEvents = getDayEvents(weekStart)
      weekEvents[weekStart.getTime()] = dayEvents
    }
    return weekEvents
  }, [getDayEvents])

  useEffect(() => {
    // When we have a new calendar, we want to fill in the info for the current week by calling getDayEvents for each day in the monday-friday range
    if (calendar) {
      const newEvents = calendar.getAllSubcomponents('vevent').map(e => new IcalEvent(e))
      setEvents(newEvents)
    }
  }, [calendar, setEvents])

  useEffect(() => {
    // New events means we need to update the iterators to the current week (+7 days for the next week)
    if (events) {
      const toDate = new Date()
      toDate.setDate(toDate.getDate() + 7)
      for (const event of events) {
        // We can call this for all events since it filters out reoccuring events
        updateEventIter(event, toDate)
      }
    }
  }, [events, updateEventIter])

  const ready = useMemo(() => !!events && !!calendar && !!rawCalendar, [events, calendar, rawCalendar])

  return {
    setCalendarFromFile, getDayEvents, getWeekEvents, events, ready
  }
}
