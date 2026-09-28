const PLANS = [
  {
    key: 'free',
    name: 'Free',
    price: 0,
    tagline: 'Try the optimizer',
    features: ['5 optimized searches / month', 'Nearby airport expansion', '1 saved trip'],
  },
  {
    key: 'pro',
    name: 'Pro',
    price: 499,
    highlighted: true,
    tagline: 'For frequent planners',
    features: [
      'Unlimited searches',
      'Unlimited saved trips',
      'Multi-city routing (up to 4 countries)',
      'Price alerts',
    ],
  },
  {
    key: 'business',
    name: 'Business',
    price: 1499,
    tagline: 'For teams booking travel',
    features: ['Everything in Pro', 'Multiple traveler profiles', 'Priority support'],
  },
];

export { PLANS };
