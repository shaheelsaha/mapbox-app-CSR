import { initializeApp } from 'firebase/app';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyCdVmlvAXMhJPmMY1WZvjUgcHQ_WaP0Zq0",
    authDomain: "map-animator-4a34c.firebaseapp.com",
    projectId: "map-animator-4a34c",
    storageBucket: "map-animator-4a34c.firebasestorage.app",
    messagingSenderId: "380831293044",
    appId: "1:380831293044:web:8a0d8ef7cf0925b3fb1f12"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const storage = getStorage(app);

export { storage, ref, uploadBytes, getDownloadURL };
