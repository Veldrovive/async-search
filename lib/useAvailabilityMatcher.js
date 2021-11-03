import { useCallback, useEffect, useMemo, useState } from "react"
import useAvailability from "./useAvailability"
import useCalendar from "./useCalendar"
import * as ics from 'ics'
import { saveAs } from "file-saver"

/*
TIMESLOT:
{
  start: FLOAT (hour value),
  duration: INTEGER (ms),
  options: [
    {
      pathDistance: FLOAT (latnlg diff squared),
      path: [
        buildingCode: STRING,
        room: STRING
      ]
    }
  ]
}
*/

const getFreeTimes = (events, startHour, endHour) => {
  // To do this, we first create an array of arrays where the subarray is the start and end time of a given event. We order this array
  // by increasing start time. Then, starting from the end of the array, if the start time of this event is less than or equal to the end time of the previous,
  // Then we combine these two where the first value is the start of the earlier event and the second value is the end of the later event
  // We then work backwards and do this for every event until we have blocks of time that are taken
  const dayEventTimes = []
  for (const event of events) {
    dayEventTimes.push(...event.times.map(time => ([time, time+event.duration/(1000*60*60), event, event])))
  }
  dayEventTimes.sort((a, b) => a[0] - b[0])
  for (let i = dayEventTimes.length - 1; i > 0; i--) {
    if (dayEventTimes[i][0] <= dayEventTimes[i-1][1]) {
      dayEventTimes[i-1][1] = dayEventTimes[i][1]
      dayEventTimes[i-1][3] = dayEventTimes[i][3]
      dayEventTimes.splice(i, 1)
    }
  }
  // Now we start from startHour and construct an array of { start, end } objects for each period of time not covered by an array in dayEventTimes
  const daySchedule = []
  let currentStart = startHour
  let currentStartBuildingCode = null
  for (const [start, end, startEvent, endEvent] of dayEventTimes) {
    if (start > currentStart) {
      daySchedule.push({ start: currentStart, end: start, startBuilding: currentStartBuildingCode, endBuilding: startEvent.buildingCode })
    }
    currentStart = end
    currentStartBuildingCode = endEvent.buildingCode
  }
  if (currentStart < endHour) {
    daySchedule.push({ start: currentStart, end: endHour, startBuilding: currentStartBuildingCode, endBuilding: null })
  }
  return daySchedule
}

const sigmoid = x => 1 / (1 + Math.exp(-x))
const difSigmoid = x => 4*(sigmoid(2*x)*(1-sigmoid(2*x)))

const scoreRoomIdSimilarity = (id1, id2) => {
  // Starting from the right most character, if the characters are the same, we add 2^n where n is the character number to the score. If they are different, we add 0.
  // Easiest way to do this? Reverse both strings and then iterate from left to right
  const id1Reverse = id1.split("").reverse()
  const id2Reverse = id2.split("").reverse()
  let score = 0
  for (let i = 0; i < Math.min(id1Reverse.length, id2Reverse.length); i++) {
    if (id1Reverse[i] === id2Reverse[i]) {
      score += difSigmoid(id1Reverse[i]-id2Reverse[i]) * Math.pow(2, i)
    }
  }
  return score
}

const scorePath = (path, startLatLng, waitLatLng, endLatLng, buildingCode, favorites) => {
  // Scores how good a path is based on the distance the person has to walk to get from their previous class and to the next class
  // as well as how many times the person has to change rooms during the timeslot.
  // The score is (distSqr(startLatLng, waitLatLng) + distSqr(waitLatLng, endLatLng))*path.length

  const distSqr = (latLng1, latLng2) => {
    const [lat1, lng1] = latLng1
    const [lat2, lng2] = latLng2
    return (lat1-lat2)*(lat1-lat2) + (lng1-lng2)*(lng1-lng2)
  }

  const score = (distSqr(startLatLng, waitLatLng) + distSqr(waitLatLng, endLatLng))*path.length
  if (favorites && favorites.includes(buildingCode)) {
    return score / 100
  }
  return score
}

const getTopN = (paths, topN, singleBuildingLimit) => {
  // Low scores are better so now we sort the path scores in ascending order
  paths.sort((a, b) => a.score - b.score)
  // And now we find the first topN paths that does not violate the singleBuildingLimit
  const topNPaths = []
  const buildingUsages = {}
  while (topNPaths.length < topN && paths.length > 0) {
    const path = paths.shift()
    const pathBuilding = path.buildingCode
    if (buildingUsages[pathBuilding] === undefined) {
      buildingUsages[pathBuilding] = 0
    }
    if (buildingUsages[pathBuilding] < singleBuildingLimit) {
      topNPaths.push(path)
      buildingUsages[pathBuilding]++
    }
  }
  return topNPaths
}

export default function useAvailabilityMatcher(startHour=8, endHour=21) {
  // This hook combines the functionality of useCalendar and useAvailability to find the best rooms
  // for the days where availability data is given
  const { setCalendarFromFile, getWeekEvents, ready: calReady } = useCalendar()
  const { buildings, ready: buildingsReady } = useAvailability()

  const [favorites, setFavorites] = useState([])

  const getTimeslotPaths = useCallback((dayTime, timeslot) => {
    // dayTime is the time of midnight for this day in milliseconds
    // A timeslot is an object with start and end times given in 24 hour time hours
    // This function finds the closest rooms that are available for the entire timeslot or for a good amount of the timeslot
    const startHour = Math.floor(timeslot.start)
    const endHour = Math.ceil(timeslot.end)
    const buildingPaths = {}
    for (const building of buildings) {
      const allRooms = building.rooms
      const openTimes = {}
      for (const room of allRooms) {
        openTimes[room.room] = {
          times: [], // Holds the [startHour, endHour] arrays
          curStartTime: null, // Holds the start time of the current open period. This does not change until the next start time is not equal to the last end time.
          lastEndTime: null // Holds the end time of the last open period
        }
      }

      // We start by computing sets of start and end times for openings of each room. For each room that is availble at startHour, we begin an iterative process.
      // We assume the person stay in that room until it becomes unavailable. Then we find the room that has a start time before this and has the further away end time.
      // We can then iterate this until the further away end time is before the endHour of the timeslot. This finds the optimal paths for the building.
      // It is likely that most buildings will have a room open the entire time so there will be paths with length 1.
      // We can score paths by their length as well as how similar their room ids are. Rooms with the same 1st characters are on the same floor. Those with the same second character are near eachother and so on.
      // This is confounded by the fact that sometimes a room will have a letter before the number code. Not sure exactly what effect that will have
      const roomHours = building.availableRooms[dayTime]
      if (roomHours) {
        // roomHours is an object where the key is the hour the rooms are open
        // DYNAMIC PROGRAMMING GO!!
        for (let hour = startHour; hour < endHour; hour++) {
          const rooms = roomHours[hour]
          if (rooms) {
            for (const room of rooms) {
              const roomOpenTimes = openTimes[room.room]
              if (roomOpenTimes.curStartTime === null) {
                // Then this is the first time the room has been open in this timeslot
                roomOpenTimes.curStartTime = hour
                roomOpenTimes.lastEndTime = hour+1
              } else if (roomOpenTimes.lastEndTime < hour) {
                // Then we had a gap where this room was not open. If there is a start and end time set, add it to times and then reset the start and end.
                if (roomOpenTimes.curStartTime !== null) {
                  roomOpenTimes.times.push([roomOpenTimes.curStartTime, roomOpenTimes.lastEndTime])
                }
                roomOpenTimes.curStartTime = hour
                roomOpenTimes.lastEndTime = hour+1
              } else {
                // Then we have an open period that is a continuation of that last open period
                roomOpenTimes.lastEndTime = hour+1
              }
            }
          }
        }
        // We got to the end of the timeslot. For each of the rooms, if there is a start and end time set, add it to times.
        for (const room of allRooms) {
          const roomOpenTimes = openTimes[room.room]
          if (roomOpenTimes.curStartTime !== null) {
            roomOpenTimes.times.push([roomOpenTimes.curStartTime, roomOpenTimes.lastEndTime])
          }
        }
      }

      // Now we know when each room is open during the timeslot. We just need to slot them together and find the best path.
      // The first step to doing that is finding the candidate paths. This is done by finding all rooms that have a start time of startHour
      const seedRooms = Object.fromEntries(Object.entries(openTimes).filter(([room, roomOpenTimes]) => roomOpenTimes.times.some(time => time[0] === startHour)))
      const paths = Object.entries(seedRooms).map(([room, roomOpenTimes]) => [{ room, time: roomOpenTimes.times[0] }])
      const invalidPaths = []
      // console.log("Starting paths for building", building.code, ":", paths)
      for (const pathIndex in paths) {
        const path = paths[pathIndex]
        // Now we need to add to the path until the final time is equal to the endHour of the timeslot
        // Or until we hit the break condition of having no more rooms open at the pathEndHour
        let pathEndHour = path[0].time[1]
        let lastRoom = path[0].room
        let count = 100
        while (pathEndHour < endHour && count > 0) {
          const potentialRooms = Object.entries(openTimes)
            .map(([room, roomOpenTimes]) => ({ room, time: roomOpenTimes.times.find(time => time[0] <= pathEndHour && time[1] > pathEndHour) }))
            .filter(room => room.time !== undefined)
          // Each element of the potentialRooms array is an object with the room id and the time period over which the room is open. This time period is filtered to always overlap with the last pathEndHour
          if (potentialRooms.length === 0) {
            count = 0
          } else {
            const bestRoom = potentialRooms.reduce((bestRoom, room) => {
              if (!bestRoom || room.time[1] > bestRoom.time[1] || (room.time[1] === bestRoom.time[1] && scoreRoomIdSimilarity(lastRoom, bestRoom.room) < scoreRoomIdSimilarity(lastRoom, room.room))) {
                // This will replace the best room if
                // 1. The best room does not exist yet. This means this is the first iteration of the reduce
                // 2. The end time of the new room is greater than the end time of the best room. This is always preferable as it means less moving around (Well not actually. But to a good approximation of the truth).
                // 3. The end time of the new room is equal to the end time of the best room, but the new room has a name closer to the last room.
                const newBest = { room: room.room, time: [pathEndHour, room.time[1]] }
                return newBest
              } else {
                return bestRoom
              }
            }, null)
            path.push(bestRoom)
            pathEndHour = bestRoom.time[1]
            lastRoom = bestRoom.room
            count-- // Just in case. You never know when you'll accidentally get stuck in an infinite loop
          }
        }
        // If the pathEndHour is not equal to the endHour, then this was an invalid path and we should remove it.
        // Since we are iterating over the paths, we cannot just remove it so we mark it as invalid.
        // console.log(pathEndHour, path)
        if (pathEndHour !== endHour) {
          invalidPaths.push(pathIndex)
        }
      }
      // and now after we are done iterating we can remove the invalid paths
      for (const invalidPathIndex of invalidPaths.reverse()) {
        paths.splice(invalidPathIndex, 1)
      }
      // console.log("Got paths for code", building.code, paths)
      buildingPaths[building.code] = paths
    }

    return buildingPaths
  }, [buildings])

  const getBuildingLatLng = useCallback((buildingCode) => {
    const building = buildings.find(building => building.code === buildingCode)
    if (building) {
      return building.latlng
    } else {
      return [0, 0]
    }
  }, [buildings])

  const bestRoomSchedule = useMemo(() => {
    // console.log("Starting to find best room schedule", calReady, buildingsReady)
    // This will store an object where the keys are the time value of the day
    // The values is an array of objects of type TIMESLOT
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayStartTime = todayStart.getTime()
    if (calReady && buildingsReady) {
      // console.log("Buildings:", buildings)
      const weekEvents = getWeekEvents(new Date())
      const schedule = {}
      for (const [dayTime, events] of Object.entries(weekEvents)) {
        // First, we create an array of { start: FLOAT(hour value), end: FLOAT } that defines when the person is free this day
        if (dayTime < todayStartTime) {
          // If this day is in the past, don't generate a schedule for it.
          continue
        }
        const daySchedule = []
        schedule[dayTime] = daySchedule
        const freeSchedule = getFreeTimes(events, startHour, endHour)
        // console.log("Day events for", (new Date(Number(dayTime))).toDateString(), freeSchedule)
        for (const timeslot of freeSchedule) {
          const potentialPaths = getTimeslotPaths(dayTime, timeslot)
          const startBuildingCode = timeslot[2]
          const endBuildingCode = timeslot[3]
          // Using these building codes, we need to find the lattitude and longitude of the buildings
          const startBuildingLatLng = getBuildingLatLng(startBuildingCode)
          const endBuildingLatLng = getBuildingLatLng(endBuildingCode)
          const pathScores = []
          for (const [buildingCode, paths] of Object.entries(potentialPaths)) {
            const buildingLatLng = getBuildingLatLng(buildingCode)
            for (const path of paths) {
              pathScores.push({ score: scorePath(path, startBuildingLatLng, buildingLatLng, endBuildingLatLng, buildingCode, favorites), buildingCode, path })
            }
          }
          const topNPaths = getTopN(pathScores, 10, 2)
          daySchedule.push({ timeslot, topNPaths })
          // console.log("Path scores for", (new Date(Number(dayTime))).toDateString(), timeslot, pathScores, topNPaths)
        }
      }
      return schedule
    }
  }, [calReady, buildingsReady, getBuildingLatLng, favorites, buildings, endHour, getTimeslotPaths, getWeekEvents, startHour])

  // useEffect(() => {
  //   console.log("Best room schedule updated", bestRoomSchedule)
  // }, [bestRoomSchedule])

  const scheduleIcs = useMemo(() => {
    const createEvent = (date, timeslot, paths) => {
      const durationHours = timeslot.end-timeslot.start
      const durationMinutes = (durationHours - Math.floor(durationHours)) * 60
      let pathString = ""
      for (const { buildingCode, path } of paths) {
        pathString += `${buildingCode}: ${path.map(({ room, time }) => `${room}(${time[0]}-${time[1]})`).join(' -> ')}\n`
      }
      let description
      if (paths.length < 1) {
        description = "There is no building with a room open for this entire break. Check sync search for individual rooms."
      } else {
        description = `These rooms are open for your entire break:\n\n${pathString}`
      }
      const event = {
        // Start is an array of [year, month, day, hour, minute]. We need to get the hour and minute from the timeslot and year and month from date
        start: [date.getFullYear(), date.getMonth() + 1, date.getDate(), Math.floor(timeslot.start), (timeslot.start - Math.floor(timeslot.start)) * 60],
        duration: { hours: Math.floor(durationHours), minutes: durationMinutes },
        title: `${Math.floor(durationHours)} Hour Break`,
        description
      }
      return event
    }

    if (bestRoomSchedule) {
      const events = []
      for (const [dayTime, daySchedule] of Object.entries(bestRoomSchedule)) {
        const day = new Date(Number(dayTime))
        for (const {timeslot, topNPaths} of daySchedule) {
          // console.log("Adding event on", day.toDateString(), timeslot, topNPaths)
          const event = createEvent(day, timeslot, topNPaths)
          events.push(event)
        }
      }
      // console.log("Events:", events, ics)
      const { value: calendar } = ics.createEvents(events)
      return calendar
    }
  }, [bestRoomSchedule])

  const downloadSchedule = useCallback(() => {
    if (scheduleIcs) {
      const blob = new Blob([scheduleIcs], {type: "text/calendar;charset=utf-8"})
      saveAs(blob, "schedule.ics")
      return true
    }
    return false
  }, [scheduleIcs])

  const pathsReady = useMemo(() => !!scheduleIcs, [scheduleIcs])

  return {
    setCalendarFromFile, bestRoomSchedule, setFavorites, favorites, scheduleIcs, downloadSchedule,
    calReady, buildingsReady, pathsReady
  }
}
