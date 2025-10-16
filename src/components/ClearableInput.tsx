import React from "react";

type ClearableInputProps = {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    className?: string; // default: "gw-input"
    inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
};

const ClearableInput: React.FC<ClearableInputProps> = ({
    value,
    onChange,
    placeholder,
    className = "gw-input",
    inputProps,
}) => {
    return (
        <div className="gw-clearable">
            <input
                {...inputProps}
                className={className}
                value={value}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)}
            />
            {value?.trim() ? (
                <button
                    type="button"
                    className="gw-clear-btn"
                    aria-label="Rensa fält"
                    title="Rensa"
                    onClick={() => onChange("")}
                >
                    ×
                </button>
            ) : null}
        </div>
    );
};

export default ClearableInput;
