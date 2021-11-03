export default async function handler(req, res) {
  const newRooms = await fetch("https://madlab01.act.utoronto.ca/RoomAvailability/lsm_query.json")
  const newRoomMeta = await fetch("https://madlab01.act.utoronto.ca/RoomAvailability/lsm_buildings.json")
  const newRoomsJSON = await newRooms.json()
  const newRoomMetaJSON = await newRoomMeta.json()

  // First we wrangle the data into a format the actually makes sense
  const rooms = newRoomsJSON.items.map(({ book_date, building, room, time }) => {
    // The date is in a yymmdd format and we want it to be a date object
    const digits = book_date.toString().split("")
    const year = Number(digits.slice(0, 2).join(""))+2000
    const month = Number(digits.slice(2, 4).join(""))
    const day = Number(digits.slice(4, 6).join(""))
    const date = new Date(year, month-1, day)

    // And of course time is in the hh:mm format. We want this to be a number
    const hour = Number(time.split(":")[0]) + Number(time.split(":")[1])/60

    return {
      date,
      building_code: building,
      room,
      hour
    }
  })

  // Then we format it such that each building makes sense
  const buildings = newRoomMetaJSON.items.map(({ bd_code, bd_name, bd_address, bd_marker, rooms }) => ({
    code: bd_code,
    name: bd_name,
    address: bd_address,
    latlng: bd_marker.split(",").map(Number),
    rooms: rooms.map(({ room_number, capacity, wheelchair_accessible }) => ({ room: room_number, capacity, wheelchair_accessible })),
    availableRooms: {}
  }))
  const code_to_index = {}
  buildings.forEach((building, index) => {
    code_to_index[building.code] = index
  })

  // And then we fill the availableRooms object where the key is the date and the value is another object where the key is the hour and the value is an array of rooms
  for (const roomData of rooms) {
    const { date, building_code, room, hour } = roomData
    const time = date.getTime()
    const index = code_to_index[building_code]
    if (index == undefined) {
      console.log("Room has no building:", building_code, room, hour, index)
      continue
    }
    const availableRooms = buildings[index].availableRooms
    if (!availableRooms[time]) {
      availableRooms[time] = {}
    }
    if (!availableRooms[time][hour]) {
      availableRooms[time][hour] = []
    }
    availableRooms[time][hour].push(roomData)
  }


  res.status(200).json({ buildings })
}
