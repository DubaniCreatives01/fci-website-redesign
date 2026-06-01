document.addEventListener('DOMContentLoaded', () => {
    // ==========================================================================
    // HIGH-PERFORMANCE INTERSECTION OBSERVER REVEAL ENGINE
    // ==========================================================================
    const revealElements = document.querySelectorAll('.reveal');
    
    const revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
                // Unobserve once animated to maintain excellent performance
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px' // Trigger slightly before element enters view fully
    });
    
    revealElements.forEach(element => {
        revealObserver.observe(element);
    });

    // ==========================================================================
    // SCROLL-TRIGGERED STATS COUNTER SYSTEM
    // ==========================================================================
    const statsSection = document.querySelector('.stats-grid');
    const statNums = document.querySelectorAll('.stat-num');
    let hasCounted = false;
    
    const countUp = (element) => {
        const target = parseInt(element.getAttribute('data-target'), 10);
        const prefix = element.getAttribute('data-prefix') || '';
        const suffix = element.getAttribute('data-suffix') || '';
        
        let current = 0;
        const duration = 2000; // 2 seconds total animation
        const steps = 60;
        const stepTime = duration / steps;
        const increment = Math.ceil(target / steps);
        
        const counter = setInterval(() => {
            current += increment;
            if (current >= target) {
                current = target;
                clearInterval(counter);
            }
            element.textContent = `${prefix}${current}${suffix}`;
        }, stepTime);
    };
    
    if (statsSection && statNums.length > 0) {
        const statsObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !hasCounted) {
                    statNums.forEach(num => countUp(num));
                    hasCounted = true;
                    observer.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.2
        });
        
        statsObserver.observe(statsSection);
    }
});
