import brainHeroImg from "../../assets/brain-hero.png";

export default function BrainHero() {
  return (
    <div className="brain-hero">
      <img
        className="brain-hero-img"
        src={brainHeroImg}
        alt=""
        width={640}
        height={400}
        decoding="async"
      />
    </div>
  );
}
