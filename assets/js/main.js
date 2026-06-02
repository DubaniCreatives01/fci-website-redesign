document.addEventListener('DOMContentLoaded', () => {
    // ==========================================================================
    // STICKY HEADER SCROLL TRANSITIONS
    // ==========================================================================
    const header = document.querySelector('.main-header');
    
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            header.classList.add('shrink');
        } else {
            header.classList.remove('shrink');
        }
    });

    // ==========================================================================
    // MOBILE NAVIGATION DRAWER SYSTEM
    // ==========================================================================
    const hamburger = document.querySelector('.hamburger');
    const navMenu = document.querySelector('.nav-menu');
    
    if (hamburger && navMenu) {
        hamburger.addEventListener('click', () => {
            hamburger.classList.toggle('active');
            navMenu.classList.toggle('open');
        });
        
        // Close menu on overlay link clicks (except dropdown toggle)
        document.querySelectorAll('.nav-link:not(.dropdown-toggle)').forEach(link => {
            link.addEventListener('click', () => {
                hamburger.classList.remove('active');
                navMenu.classList.remove('open');
            });
        });

        // Mobile dropdown click toggle
        const dropdownToggle = document.querySelector('.dropdown-toggle');
        if (dropdownToggle) {
            dropdownToggle.addEventListener('click', (e) => {
                if (window.innerWidth <= 991) {
                    e.preventDefault();
                    e.stopPropagation();
                    dropdownToggle.parentElement.classList.toggle('active-mobile');
                }
            });
        }
    }

    // ==========================================================================
    // PREMIUM LIGHTBOX SYSTEM (Photos & Walkthrough Videos)
    // ==========================================================================
    const lightbox = document.createElement('div');
    lightbox.className = 'lightbox';
    lightbox.innerHTML = `
        <div class="lightbox-content">
            <button class="lightbox-close" aria-label="Close modal">&times;</button>
            <div class="lightbox-media-container"></div>
        </div>
    `;
    document.body.appendChild(lightbox);
    
    const mediaContainer = lightbox.querySelector('.lightbox-media-container');
    const closeBtn = lightbox.querySelector('.lightbox-close');
    
    const openLightbox = (element) => {
        mediaContainer.innerHTML = '';
        const isVideo = element.getAttribute('data-type') === 'video';
        const src = element.getAttribute('data-src') || element.getAttribute('href');
        
        if (isVideo) {
            const video = document.createElement('video');
            video.src = src;
            video.controls = true;
            video.autoplay = true;
            video.style.width = '100%';
            video.style.borderRadius = '8px';
            mediaContainer.appendChild(video);
        } else {
            const img = document.createElement('img');
            img.src = src;
            img.style.width = '100%';
            img.style.height = 'auto';
            img.style.borderRadius = '8px';
            mediaContainer.appendChild(img);
        }
        
        lightbox.classList.add('active');
        document.body.style.overflow = 'hidden';
    };
    
    const closeLightbox = () => {
        lightbox.classList.remove('active');
        mediaContainer.innerHTML = '';
        document.body.style.overflow = 'auto';
    };
    
    // Attach event listeners to gallery item links
    document.querySelectorAll('.lightbox-trigger').forEach(trigger => {
        trigger.addEventListener('click', (e) => {
            e.preventDefault();
            openLightbox(trigger);
        });
    });
    
    if (closeBtn) {
        closeBtn.addEventListener('click', closeLightbox);
    }
    
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) {
            closeLightbox();
        }
    });
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && lightbox.classList.contains('active')) {
            closeLightbox();
        }
    });

    // ==========================================================================
    // FLOATING FORM FLOATING LABELS (Form Helper)
    // ==========================================================================
    const formControls = document.querySelectorAll('.form-control');
    formControls.forEach(control => {
        // Set initial placeholder to single space to trigger :not(:placeholder-shown) in CSS
        if (!control.getAttribute('placeholder')) {
            control.setAttribute('placeholder', ' ');
        }
    });

    // ==========================================================================
    // LIVE WEATHER & DIGITAL CLOCK FOR WIDGET
    // ==========================================================================
    const timeDisplay = document.getElementById('widget-time-display');
    const dateDisplay = document.getElementById('widget-date-display');
    const tempDisplay = document.getElementById('widget-temp');
    const condDisplay = document.getElementById('widget-cond');
    
    if (timeDisplay && dateDisplay) {
        const updateClock = () => {
            const now = new Date();
            let hours = now.getHours().toString().padStart(2, '0');
            let minutes = now.getMinutes().toString().padStart(2, '0');
            let seconds = now.getSeconds().toString().padStart(2, '0');
            timeDisplay.textContent = `${hours}:${minutes}:${seconds}`;
            
            const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
            dateDisplay.textContent = now.toLocaleDateString('en-ZA', options);
        };
        
        updateClock();
        setInterval(updateClock, 1000);
    }
    
    if (tempDisplay && condDisplay) {
        const updateWeather = () => {
            const hour = new Date().getHours();
            let temp = 18;
            let cond = "Clear Sky";
            if (hour >= 6 && hour < 12) {
                temp = 19;
                cond = "Mild & Sunny";
            } else if (hour >= 12 && hour < 17) {
                temp = 22;
                cond = "Partly Cloudy";
            } else if (hour >= 17 && hour < 21) {
                temp = 17;
                cond = "Cool Breeze";
            } else {
                temp = 14;
                cond = "Clear & Cold";
            }
            tempDisplay.textContent = `${temp}°C`;
            condDisplay.textContent = cond;
        };
        
        updateWeather();
        // Update weather hourly
        setInterval(updateWeather, 3600000);
    }

    // Dynamic Forecast Days Calculation
    const fDay1 = document.getElementById('forecast-day-1');
    const fDay2 = document.getElementById('forecast-day-2');
    const fDay3 = document.getElementById('forecast-day-3');
    
    if (fDay1 && fDay2 && fDay3) {
        const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const updateForecastDays = () => {
            const today = new Date();
            
            const nextDay1 = new Date(today);
            nextDay1.setDate(today.getDate() + 1);
            fDay1.textContent = daysOfWeek[nextDay1.getDay()];
            
            const nextDay2 = new Date(today);
            nextDay2.setDate(today.getDate() + 2);
            fDay2.textContent = daysOfWeek[nextDay2.getDay()];
            
            const nextDay3 = new Date(today);
            nextDay3.setDate(today.getDate() + 3);
            fDay3.textContent = daysOfWeek[nextDay3.getDay()];
        };
        
        updateForecastDays();
        // Update days daily at midnight
        setInterval(updateForecastDays, 3600000);
    }
});
