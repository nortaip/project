import React from "react";

interface OpportunityDetailsModalProps {
  opportunity: any;
  creator?: any;
  offers?: any[];
  profiles: { [id: string]: any };
  onClose: () => void;
  onEditOffer: (offer: any) => void;
}

export const OpportunityDetailsModal: React.FC<OpportunityDetailsModalProps> = ({
  opportunity,
  creator,
  offers = [],
  profiles,
  onClose,
  onEditOffer,
}) => {
  // JSON cavabları oxu
  let extra: any[] = [];
  try {
    extra = Object.entries(JSON.parse(opportunity.extra_answers || "{}"));
  } catch (e) {
    extra = [];
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg p-8 w-full max-w-lg shadow-xl relative">
        <button className="absolute right-3 top-3 text-2xl" onClick={onClose}>&times;</button>
        <h2 className="text-2xl font-bold mb-4">{opportunity.title}</h2>
        <div className="mb-2"><b>Status:</b> {opportunity.status || "—"}</div>
        <div className="mb-2"><b>Yaradan:</b> {creator ? `${creator.name} (${creator.phone_number || "—"})` : opportunity.created_by}</div>
        <div className="mb-2"><b>Tarix:</b> {opportunity.date}</div>
        <div className="mb-2"><b>Location:</b> {opportunity.location}</div>
        <div className="mb-2"><b>Büdcə:</b> {opportunity.budget ?? "—"} ₼</div>
        <div className="mb-2"><b>Açıqlama:</b> {opportunity.description}</div>

        <div className="border-t pt-3 mt-2">
          <b>Əlavə Suallar və Cavablar:</b>
          {extra.length > 0 ? (
            <table className="min-w-full text-xs mt-2">
              <tbody>
                {extra.map(([k, v]) => (
                  <tr key={k}>
                    <td className="pr-2 font-medium text-gray-700">{k.replace(/_/g, " ")}:</td>
                    <td className="text-gray-800">{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-xs text-gray-400 mt-2">Əlavə məlumat yoxdur.</div>
          )}
        </div>

        <div className="border-t pt-3 mt-3">
          <b>Təkliflər:</b>
          <ul>
            {offers.length === 0 && <li className="text-xs text-gray-400">Təklif yoxdur</li>}
            {offers.map((offer: any) => {
              const provider = profiles?.[offer.provider_id];
              return (
                <li key={offer.id} className="flex items-center gap-2 py-1">
                  <span>
                    Məbləğ: <b>{offer.offer_amount} ₼</b>
                    {provider && (
                      <span className="ml-2 text-xs text-gray-600">
                        ({provider.name}, {provider.phone_number || "—"})
                      </span>
                    )}
                  </span>
                  <button
                    className="ml-2 text-xs bg-yellow-200 rounded px-2 py-1"
                    onClick={() => onEditOffer(offer)}
                  >
                    Düzəliş et
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
};
