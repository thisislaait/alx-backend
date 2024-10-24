#!/usr/bin/env yarn dev
import express from 'express';
import { promisify } from 'util';
import { createQueue } from 'kue';
import { createClient } from 'redis';

const app = express();
const client = createClient({ name: 'reserve_seat' });
const queue = createQueue();
const INITIAL_SEATS_COUNT = 50;
let reservationEnabled = false;
const PORT = 1245;

// Connect the Redis client
client.connect().catch((err) => {
  console.error('Redis Client Connection Error', err);
});

// Handle Redis client errors
client.on('error', (err) => {
  console.error('Redis Client Error', err);
});

// Modify the number of available seats
const reserveSeat = async (number) => {
  return promisify(client.SET).bind(client)('available_seats', number);
};

// Retrieve the number of available seats
const getCurrentAvailableSeats = async () => {
  return promisify(client.GET).bind(client)('available_seats');
};

// Route to get available seats
app.get('/available_seats', async (_, res) => {
  try {
    const numberOfAvailableSeats = await getCurrentAvailableSeats();
    res.json({ numberOfAvailableSeats: Number(numberOfAvailableSeats || 0) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve available seats' });
  }
});

// Route to reserve a seat
app.get('/reserve_seat', (_req, res) => {
  if (!reservationEnabled) {
    res.json({ status: 'Reservation are blocked' });
    return;
  }

  try {
    const job = queue.create('reserve_seat');

    job.on('failed', (err) => {
      console.log('Seat reservation job', job.id, 'failed:', err.message || err.toString());
    });

    job.on('complete', () => {
      console.log('Seat reservation job', job.id, 'completed');
    });

    job.save();
    res.json({ status: 'Reservation in process' });
  } catch {
    res.json({ status: 'Reservation failed' });
  }
});

// Route to process the reservation queue
app.get('/process', (_req, res) => {
  res.json({ status: 'Queue processing' });
  
  queue.process('reserve_seat', async (_job, done) => {
    try {
      const availableSeats = await getCurrentAvailableSeats();
      const currentAvailableSeats = Number.parseInt(availableSeats || 0);
      
      if (currentAvailableSeats <= 1) {
        reservationEnabled = false;
      }

      if (currentAvailableSeats > 0) {
        await reserveSeat(currentAvailableSeats - 1);
        done(); // Successful reservation
      } else {
        done(new Error('Not enough seats available')); // Fail job
      }
    } catch (error) {
      done(error); // Handle error
    }
  });
});

// Reset available seats in Redis
const resetAvailableSeats = async (initialSeatsCount) => {
  return promisify(client.SET).bind(client)('available_seats', Number.parseInt(initialSeatsCount));
};

// Start the server and initialize available seats
app.listen(PORT, async () => {
  try {
    await resetAvailableSeats(process.env.INITIAL_SEATS_COUNT || INITIAL_SEATS_COUNT);
    reservationEnabled = true;
    console.log(`API available on localhost port ${PORT}`);
  } catch (error) {
    console.error('Failed to reset available seats:', error);
  }
});

export default app;
