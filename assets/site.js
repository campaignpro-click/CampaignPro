/* CampaignPro site script: shared by every page.
   Scroll reveal, progress bar, mobile booking bar, Book-button scrolling,
   and Clarity + GA4 tracking for Book clicks and Calendly bookings. */
(function(){
// Reveal-on-scroll (content stays visible without JS)
var io=('IntersectionObserver' in window)?new IntersectionObserver(function(entries){
entries.forEach(function(en){if(en.isIntersecting){en.target.classList.add('show');io.unobserve(en.target);}});
},{threshold:0,rootMargin:"0px 0px -60px 0px"}):null;
document.querySelectorAll('.reveal').forEach(function(el){io?io.observe(el):el.classList.add('show');});

// Scroll progress bar + mobile sticky CTA
var bar=document.getElementById('progress-bar'),mcta=document.getElementById('mobile-cta'),booking=document.getElementById('booking');
function onScroll(){
var d=document.documentElement,max=d.scrollHeight-d.clientHeight;
if(bar)bar.style.width=(max>0?(d.scrollTop/max)*100:0)+'%';
if(!mcta||!booking)return;
var b=booking.getBoundingClientRect(),show=window.scrollY>600&&b.top>window.innerHeight*0.9;
mcta.classList.toggle('translate-y-full',!show);
mcta.setAttribute('aria-hidden',show?'false':'true');
mcta.querySelector('a').tabIndex=show?0:-1;
}
window.addEventListener('scroll',onScroll,{passive:true});onScroll();

// Track Calendly booking steps in Clarity and GA4
window.addEventListener('message',function(e){
if(e.origin!=='https://calendly.com'||!e.data||typeof e.data.event!=='string')return;
var map={'calendly.date_and_time_selected':'calendly_time_selected','calendly.event_scheduled':'calendly_booked'};
var name=map[e.data.event];
if(!name)return;
if(window.clarity){clarity('event',name);if(name==='calendly_booked')clarity('set','booked','yes');}
if(window.gtag){
if(name==='calendly_booked'){gtag('event','generate_lead',{method:'calendly'});}
else{gtag('event',name);}
}
});

// "Book" buttons scroll straight to the calendar so the whole calendar is in view
// (on phones it sits below the intro text; on desktop this clears the section padding)
var calendar=document.getElementById('calendar');
document.querySelectorAll('a[href="#booking"]').forEach(function(a){
a.addEventListener('click',function(e){
if(!calendar)return;
e.preventDefault();
calendar.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
if(history.replaceState)history.replaceState(null,'','#booking');
});
});

// Track clicks on "Book a call" buttons (with which button was used)
document.querySelectorAll('a[href="#booking"]').forEach(function(a){
a.addEventListener('click',function(){
var loc=a.getAttribute('data-cta')||'other';
if(window.clarity){clarity('event','book_call_click');clarity('set','cta_location',loc);}
if(window.gtag)gtag('event','book_call_click',{cta_location:loc});
});
});
})();
