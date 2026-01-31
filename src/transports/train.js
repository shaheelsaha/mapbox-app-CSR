// 🚂 train.js
import { drive } from './car.js';

export async function train(map, start, end, pathHistory = []) {

    console.log("🚂 Train:", start, "→", end);

    // change icon - REMOVED (Handled in main.js)

    // reuse car routing logic
    return await drive(map, start, end, pathHistory);
}
