import { useCallback, useEffect, useMemo, useState } from "react"

export default function useAvailability() {
  const [buildings, setBuildings] = useState()
  const [error, setError] = useState()
  const ready = useMemo(() => !!buildings && !error, [buildings, error])

  useEffect(() => {
    // We have to set the rooms and room meta once at the start
    async function fetchData () {
      try {
        const res = await fetch("/api/availability")
        const { buildings } = await res.json()
        setBuildings(buildings)
      } catch (e) {
        setError(e)
      }
    }
    fetchData()
  }, [setBuildings])

  const getClosestRooms = useCallback((year, month, day, hour, lat, lng) => {
    if (!ready) return {}

    const time = new Date(year, month-1, day).getTime()
    function getSqrDistance ({ latlng }) {
      return (latlng[0] - lat) ** 2 + (latlng[1] - lng) ** 2
    }

    const closestRooms = []
    for (const building of buildings) {
      const availableRooms = building.availableRooms[time]
      const currentlyAvailableRooms = availableRooms ? availableRooms[hour] : []
      if (currentlyAvailableRooms && currentlyAvailableRooms.length > 0) {
        closestRooms.push({
          building: building.name,
          code: building.code,
          address: building.address,
          latlng: building.latlng,
          rooms: building.rooms,
          availableRooms: currentlyAvailableRooms
        })
      }
    }

    // Now sort the rooms by distance
    closestRooms.sort((a, b) => getSqrDistance(a) - getSqrDistance(b))
    return closestRooms
  }, [buildings, ready])

  return {
      buildings, getClosestRooms, ready, error
  }
}
