import { useEffect, useRef } from "react";
import gsap from "gsap";

type TargetCursorProps = {
  targetSelector?: string;
  spinDuration?: number;
  hoverDuration?: number;
  hideDefaultCursor?: boolean;
  parallaxOn?: boolean;
};

const isFinePointer = () => window.matchMedia("(pointer: fine)").matches;

const TargetCursor = ({
  targetSelector = "a, button, [role='button'], input, textarea, select, .cursor-target",
  spinDuration = 2,
  hoverDuration = 0.2,
  hideDefaultCursor = true,
  parallaxOn = true,
}: TargetCursorProps) => {
  const cursorRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!isFinePointer()) return;

    const cursor = cursorRef.current;
    if (!cursor) return;

    if (hideDefaultCursor) document.documentElement.classList.add("target-cursor-active");

    gsap.set(cursor, { xPercent: -50, yPercent: -50, opacity: 0 });
    const spin = gsap.to(cursor, {
      rotation: 360,
      duration: spinDuration,
      ease: "none",
      repeat: -1,
    });

    const moveCursor = (event: MouseEvent) => {
      const target = (event.target as Element | null)?.closest(targetSelector);

      if (target && target !== targetRef.current) {
        targetRef.current = target;
        const rect = target.getBoundingClientRect();
        spin.pause();
        gsap.to(cursor, {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          width: rect.width + 18,
          height: rect.height + 18,
          rotation: 0,
          opacity: 1,
          duration: hoverDuration,
          ease: "power3.out",
        });
        return;
      }

      if (!target && targetRef.current) {
        targetRef.current = null;
        spin.play();
        gsap.to(cursor, {
          width: 38,
          height: 38,
          duration: hoverDuration,
          ease: "power3.out",
        });
      }

      if (!targetRef.current) {
        gsap.to(cursor, {
          x: event.clientX,
          y: event.clientY,
          opacity: 1,
          duration: 0.16,
          ease: "power2.out",
        });
        return;
      }

      if (parallaxOn) {
        const rect = targetRef.current.getBoundingClientRect();
        gsap.to(cursor, {
          x: rect.left + rect.width / 2 + (event.clientX - (rect.left + rect.width / 2)) * 0.08,
          y: rect.top + rect.height / 2 + (event.clientY - (rect.top + rect.height / 2)) * 0.08,
          duration: 0.18,
          ease: "power2.out",
        });
      }
    };

    const hideCursor = () => gsap.to(cursor, { opacity: 0, duration: 0.2 });

    window.addEventListener("mousemove", moveCursor);
    window.addEventListener("mouseleave", hideCursor);

    return () => {
      window.removeEventListener("mousemove", moveCursor);
      window.removeEventListener("mouseleave", hideCursor);
      spin.kill();
      gsap.killTweensOf(cursor);
      document.documentElement.classList.remove("target-cursor-active");
    };
  }, [hideDefaultCursor, hoverDuration, parallaxOn, spinDuration, targetSelector]);

  return (
    <div ref={cursorRef} className="target-cursor pointer-events-none fixed left-0 top-0 z-[9999] hidden size-10 md:block" aria-hidden="true">
      <span className="target-cursor__corner target-cursor__corner--tl" />
      <span className="target-cursor__corner target-cursor__corner--tr" />
      <span className="target-cursor__corner target-cursor__corner--br" />
      <span className="target-cursor__corner target-cursor__corner--bl" />
    </div>
  );
};

export default TargetCursor;